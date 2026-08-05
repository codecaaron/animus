import {
  assembleStylesheet,
  buildSystemPropsModule,
  clearEngineCache,
  collectExternalPackageSources,
  contentHash,
  DEFAULT_EXTENSIONS,
  discoverFiles,
  enforceExternalTokenContracts,
  extractSystemFilePackages,
  findAssetSpecifiers,
  findPackageRoot,
  loadSystemConfig,
  postProcessCss,
  preprocessMdx,
  resolveAssetFile,
  resolveLightningTargets,
  runProjectAnalysis,
  serializeStaticCss,
  staleDistIncludesMessage,
  substituteAssetPlaceholders,
  toWatchKeys,
  unresolvableIncludesMessage,
} from '@animus-ui/extract/pipeline';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, extname, join, relative, resolve } from 'path';

import { resolvePackagesByName } from './resolve-packages';
import {
  engineApi,
  resetAnalysisPromise,
  setAnalysisPromise,
  setManifestJson,
  setSharedCss,
  setSharedExternalDirs,
  setSharedExternalEntries,
  setSharedSystemProps,
} from './singleton';
import { logBuildTimings } from './timing';

import type { AnimusNextOptions } from './types';
import type {
  DynamicPropMeta,
  LightningTargets,
  SystemConfig,
} from '@animus-ui/extract/pipeline';

/**
 * Module id the Rust emitter injects for the extracted stylesheet — also the
 * exact resolve.alias key with-animus registers for it, which the adapter's
 * alias harvesting must skip.
 */
export const ANIMUS_CSS_MODULE_ID = '.animus/styles.css';

/** Default path fragments excluded from source discovery (full + watch). */
const DEFAULT_EXCLUDE = [
  'node_modules',
  'dist',
  '.test.',
  '.spec.',
  '.next',
  '.animus',
];

type FileEntry = { path: string; source: string; hash: string };

/** Watch-cycle change sets, as reported by the bundler's watcher. */
export interface WatchChanges {
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
}

/**
 * Bundler-agnostic extraction pipeline: system loading, source discovery
 * and ingestion, external-package collection, analysis, stylesheet and
 * system-props emission, and watch-cycle diffing.
 *
 * The webpack adapter (plugin.ts) owns only bundler wiring: hook
 * registration, alias harvesting from the compiler config, in-memory asset
 * replacement, and translating watch events into `handleWatchUpdate`
 * change sets. Keeping this class free of webpack types is deliberate — a
 * future Turbopack integration must drive the same session from outside
 * the bundler (Turbopack has no compiler-hook surface), reusing everything
 * here unchanged.
 *
 * Outputs are published through the package singleton (shared CSS,
 * manifest, system props) and written to `.animus/` on disk.
 */
export class ExtractionSession {
  /** Set by the adapter before any pipeline run. */
  rootDir: string | null = null;
  /** Serialized path aliases, harvested by the adapter from bundler config. */
  pathAliasesJson: string | null = null;

  // Per-specifier resolve/copy memo for substituteAssetReferences — the
  // result is stable per loaded system, so it is cleared on system load.
  private assetCopyCache = new Map<
    string,
    {
      sourcePath: string;
      mtimeMs: number;
      size: number;
      fileName: string;
      url: string;
    }
  >();
  /** Physical asset files registered with the host watcher. */
  assetDependencyPaths = new Set<string>();
  private assetDependencyKeys = new Set<string>();
  /** When set (Turbopack orchestration), every analysis also persists
   *  `.animus/analysis-inputs.json` so isolated loader workers can hydrate.
   *  Webpack mode leaves this off — its loader shares the process. */
  persistAnalysisInputs = false;
  /** Emitter identity override for the system-props module id. Webpack mode
   *  (null) injects the absolute `.animus/system-props.js` path, resolved by
   *  NormalModuleReplacement; Turbopack rejects absolute-path imports, so
   *  its driver sets the virtual id that `resolveAlias` maps to disk. */
  systemPropsModuleId: string | null = null;

  /** Absolute directory prefixes for external DS packages (loader allowlisting). */
  externalPackageDirs: string[] = [];
  /** Absolute package dir → owning specifier (cross-source correlation). */
  private externalDirOwners: Record<string, string> = {};
  /** rootDir-relative external file → owning specifier (correlation join). */
  private externalFileOwners: Record<string, string> = {};
  /** External package specifier → absolute source entry path. */
  externalSourceEntries = new Map<string, string>();

  private readonly options: AnimusNextOptions;
  private readonly staticCssJson: string | null;
  private system: SystemConfig | null = null;
  /** Full package-resolution map from the last full pipeline — replayed by
   *  incremental passes (sourceEntries alone omits dist-resolved packages). */
  private lastPackageMap: Record<string, string> = {};

  // File tracking for HMR
  private fileCache = new Map<string, { hash: string; source: string }>();

  // Membership keys (lexical + canonical) for the system's evaluated
  // module-file set — the geological-reset classification set. Refreshed on
  // every successful system load; a failed reload keeps the last
  // successful set, matching the stale config still being served.
  private systemDependencyKeys: Set<string> = new Set();

  /** Loader-reported dependency paths for bundler watch registration. */
  systemDependencyPaths: string[] = [];

  // Content hashes of the dependency files at load time — the fallback
  // probe for watch passes that carry no modified/removed sets (webpack's
  // first watchRun; harnesses without watch-event translation).
  private systemDependencyHashes: Map<string, string> = new Map();
  private lastCssHash: string | null = null;
  private lastSystemPropsHash: string | null = null;
  private lastManifestHash: string | null = null;
  private lastAnalysisInputsHash: string | null = null;
  // Lightning CSS targets — resolved lazily once per session (browserslist
  // config I/O), spec: css-post-processing.
  private lcssTargets: LightningTargets | null = null;

  constructor(options: AnimusNextOptions) {
    this.options = options;
    // Serialized once (stable key order) so the analysis-inputs hash is
    // insensitive to option-object identity.
    this.staticCssJson = serializeStaticCss(options.staticCss);
  }

  get verbose(): boolean {
    return (
      this.options.verbose === true ||
      process.env.ANIMUS_DEBUG === '1' ||
      process.env.ANIMUS_DEBUG === 'true'
    );
  }

  private log(msg: string): void {
    if (this.verbose) {
      console.info(`[animus] ${msg}`);
    }
  }

  private warn(msg: string): void {
    console.warn(`[animus] ${msg}`);
  }

  // Zero-cost timer gate
  private now(): number {
    return this.verbose ? performance.now() : 0;
  }
  private elapsed(t: number): number {
    return this.verbose ? Math.round(performance.now() - t) : 0;
  }

  /** Resolve the scan configuration from options — the single source of the
   *  exclude/extension policy shared by the full and incremental pipelines. */
  private resolveScanConfig(): {
    excludePatterns: string[];
    extensionsSet: ReadonlySet<string>;
    shouldHandleMdx: boolean;
  } {
    const extensionsSet: ReadonlySet<string> = new Set(
      this.options.extensions ?? DEFAULT_EXTENSIONS
    );
    return {
      excludePatterns: this.options.exclude ?? DEFAULT_EXCLUDE,
      extensionsSet,
      shouldHandleMdx: extensionsSet.has('.mdx'),
    };
  }

  /**
   * Incremental watch pass: geological reset when the system file changed,
   * otherwise content-hash diffing restricted to the watcher's change sets
   * (falling back to a full discovery walk when no sets are provided).
   */
  async handleWatchUpdate(changes: WatchChanges): Promise<void> {
    // Guard: if system state was never loaded (non-owning instance that
    // skipped runFullPipeline), skip — processAssets reads from shared variable
    if (!this.system) return;

    const rootDir = this.rootDir!;

    // Geological reset: any changed or removed file in the system's
    // evaluated module-file set (loader-reported dependencies plus the
    // entry). Membership is keyed lexically and canonically, so events via
    // symlinked or already-deleted paths still classify. One reset per
    // watch batch — the bundler already coalesces events per rebuild.
    let assetChanged = false;
    try {
      let systemHit: string | undefined;
      if (!changes.modifiedFiles && !changes.removedFiles) {
        // No change sets (first watchRun; harnesses without watch-event
        // translation): probe the dependency files by content hash.
        for (const [dep, hash] of this.systemDependencyHashes) {
          let current = '';
          try {
            current = contentHash(readFileSync(dep, 'utf-8'));
          } catch {
            // unreadable/deleted → hash stays '' and mismatches a real one
          }
          if (current !== hash) {
            systemHit = dep;
            break;
          }
        }
      } else {
        const changed = [
          ...(changes.modifiedFiles ?? []),
          ...(changes.removedFiles ?? []),
        ];
        systemHit = changed.find((path) =>
          toWatchKeys(path).some((key) => this.systemDependencyKeys.has(key))
        );
      }
      if (systemHit) {
        this.log(
          `geological reset: system dependency changed (${relative(rootDir, systemHit)})`
        );
        this.resetForHmr();
        const promise = this.runFullPipeline();
        setAnalysisPromise(promise);
        await promise;
        return;
      }

      const changed = [
        ...(changes.modifiedFiles ?? []),
        ...(changes.removedFiles ?? []),
      ];
      if (
        changed.some((path) =>
          toWatchKeys(path).some((key) => this.assetDependencyKeys.has(key))
        )
      ) {
        // A changed asset invalidates the copy memo and forces re-analysis,
        // but the batch may ALSO carry component edits and removals (branch
        // switch, editor save-all, git checkout): fall through to the shared
        // read/re-hash/prune flow instead of replaying the cache — an entry
        // analyzed stale here would never re-surface, since its cache hash
        // was never updated.
        this.assetCopyCache.clear();
        assetChanged = true;
      }
    } catch (err) {
      // Not a benign probe: this wraps the geological-reset re-run.
      // Swallowing keeps a transient failure from crashing the watch loop,
      // but a real fault must stay diagnosable.
      this.warn(`HMR geological-reset check failed: ${String(err)}`);
    }

    // Check for component file changes using content-hash diffing
    const { excludePatterns, extensionsSet, shouldHandleMdx } =
      this.resolveScanConfig();

    // Prune deleted/renamed files so their last-known source stops riding
    // along as a ghost entry on every subsequent incremental analysis.
    let removedAny = false;
    if (changes.removedFiles) {
      for (const removedPath of changes.removedFiles) {
        const rel = relative(rootDir, removedPath);
        // MDX cache keys carry the preprocessed `.tsx` suffix.
        if (this.fileCache.delete(rel) || this.fileCache.delete(rel + '.tsx')) {
          removedAny = true;
        }
      }
    }

    // Restrict the read+hash pass to the watcher's modified set when
    // available; fall back to a full discovery walk otherwise. Filters
    // mirror discoverFiles: extension allowlist plus substring exclude
    // patterns on both path forms.
    let files: string[];
    if (changes.modifiedFiles) {
      files = [];
      for (const modifiedPath of changes.modifiedFiles) {
        if (!extensionsSet.has(extname(modifiedPath))) continue;
        const rel = relative(rootDir, modifiedPath);
        if (rel.startsWith('..')) continue;
        if (
          excludePatterns.some(
            (pattern) => modifiedPath.includes(pattern) || rel.includes(pattern)
          )
        ) {
          continue;
        }
        files.push(modifiedPath);
      }
    } else {
      files = discoverFiles(rootDir, rootDir, excludePatterns, extensionsSet);
    }

    const changedPaths: string[] = [];

    for (const filePath of files) {
      let relPath = relative(rootDir, filePath);
      let source: string;
      try {
        source = readFileSync(filePath, 'utf-8');
      } catch {
        // Benign race: the file vanished between the watch event and this
        // read — it will surface in removedFiles on the next watch cycle.
        continue;
      }

      if (shouldHandleMdx && extname(filePath) === '.mdx') {
        // Watch pass stays silent on failure — the full pipeline already
        // surfaced any missing-dep / preprocessing warning.
        const processed = await this.preprocessMdxEntry(source, relPath, {
          warn: false,
        });
        if (!processed) continue;
        source = processed.source;
        relPath = processed.relPath;
      }

      const cached = this.fileCache.get(relPath);
      const hash = contentHash(source);

      if (!cached || cached.hash !== hash) {
        changedPaths.push(relPath);
        this.fileCache.set(relPath, { hash, source });
      }
    }

    if (changedPaths.length > 0 || removedAny || assetChanged) {
      // Every cached file rides with full source (v2 has no Rust-side cache).
      const fileEntries = this.buildFileEntriesFromCache();

      resetAnalysisPromise();
      const promise = this.runIncrementalPipeline(fileEntries);
      setAnalysisPromise(promise);
      await promise;
    }
  }

  /**
   * Preprocess one `.mdx` entry into scanner-consumable tsx. Returns the
   * rewritten source plus the `relPath + '.tsx'` path on success, or null
   * when the file must be skipped.
   *
   * `warn: false` (incremental watch pass) skips silently — the full
   * pipeline already surfaced the warning. `warn: true` (full pipeline)
   * warns ONCE for a missing @mdx-js/mdx dependency via the shared
   * `missingDepFlag` holder, and every time for a preprocessing error.
   */
  private async preprocessMdxEntry(
    source: string,
    relPath: string,
    opts: { warn: boolean; missingDepFlag?: { warned: boolean } }
  ): Promise<{ source: string; relPath: string } | null> {
    const result = await preprocessMdx(source, relPath);
    if (result.kind === 'missing-dep') {
      if (opts.warn && opts.missingDepFlag && !opts.missingDepFlag.warned) {
        console.warn(
          '[animus] ⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped'
        );
        opts.missingDepFlag.warned = true;
      }
      return null;
    }
    if (result.kind === 'error') {
      if (opts.warn) {
        console.warn(
          `[animus] ⚠ MDX preprocessing failed for ${relPath}: ${result.error}`
        );
      }
      return null;
    }
    // Path rewrite so the Rust source-type helper parses as tsx.
    return { source: result.source!, relPath: relPath + '.tsx' };
  }

  async runFullPipeline(): Promise<void> {
    const pipelineStart = this.now();
    const bt: Record<string, number> = {};

    // Clear Rust-side per-file cache so stale results from a prior
    // build never bleed into a fresh pipeline run.
    clearEngineCache(engineApi);

    const rootDir = this.rootDir!;
    const resolvedSystemPath = resolve(rootDir, this.options.system);

    // Step 1: Load system via NAPI
    let t = this.now();
    this.system = loadSystemConfig(engineApi, {
      systemPath: resolvedSystemPath,
      rootDir,
      prefix: this.options.prefix,
    });
    // Asset specifiers resolve against the system just loaded — drop the
    // per-specifier copy memo so a changed reference re-reads and re-hashes.
    this.assetCopyCache.clear();
    this.assetDependencyPaths.clear();
    this.assetDependencyKeys.clear();
    {
      // Refresh the geological-reset membership set: every loader-evaluated
      // module plus (defensively) the entry, keyed lexically and
      // canonically so symlinked/deleted event paths still match.
      const deps = this.system.dependencies ?? [];
      const keys = new Set<string>();
      for (const key of toWatchKeys(resolvedSystemPath)) keys.add(key);
      for (const dep of deps) {
        for (const key of toWatchKeys(dep)) keys.add(key);
      }
      this.systemDependencyKeys = keys;
      this.systemDependencyPaths = deps;

      const hashes = new Map<string, string>();
      for (const dep of deps.length > 0 ? deps : [resolvedSystemPath]) {
        try {
          hashes.set(dep, contentHash(readFileSync(dep, 'utf-8')));
        } catch {
          // Unreadable now → the probe treats any later readability
          // change as a system change.
          hashes.set(dep, '');
        }
      }
      this.systemDependencyHashes = hashes;
    }
    bt.systemLoad = this.elapsed(t);

    // Step 2: Discover source files
    t = this.now();
    const { excludePatterns, extensionsSet, shouldHandleMdx } =
      this.resolveScanConfig();
    const missingDepFlag = { warned: false };
    const files = discoverFiles(
      rootDir,
      rootDir,
      excludePatterns,
      extensionsSet
    );

    bt.fileDiscovery = this.elapsed(t);

    // Step 3: Read file sources and build entries (preprocessing MDX as we go)
    t = this.now();
    const fileEntries: FileEntry[] = [];
    for (const filePath of files) {
      let source = readFileSync(filePath, 'utf-8');
      let relPath = relative(rootDir, filePath);

      if (shouldHandleMdx && extname(filePath) === '.mdx') {
        const processed = await this.preprocessMdxEntry(source, relPath, {
          warn: true,
          missingDepFlag,
        });
        if (!processed) continue;
        source = processed.source;
        relPath = processed.relPath;
      }

      const hash = contentHash(source);
      this.fileCache.set(relPath, { hash, source });
      fileEntries.push({ path: relPath, source, hash });
    }

    bt.fileRead = this.elapsed(t);
    bt.fileCount = fileEntries.length;

    // Step 4: Resolve external packages from system file imports. Workspace
    // walk + require.resolve stays local (the Node-resolution seam); the
    // traversal/ingest below is the shared collector
    // (spec: external-package-file-discovery).
    t = this.now();
    const packageNames = extractSystemFilePackages(resolvedSystemPath);
    const preResolved = resolvePackagesByName(rootDir, packageNames);

    const collected = await collectExternalPackageSources({
      specifiers: packageNames,
      resolveSpecifier: (name) =>
        preResolved[name] ? resolve(rootDir, preResolved[name]) : null,
      rootDir,
      extensionsSet,
      hasEntry: (relPath) => fileEntries.some((e) => e.path === relPath),
      preprocessFile: async (source, relPath, absPath) => {
        if (shouldHandleMdx && extname(absPath) === '.mdx') {
          return this.preprocessMdxEntry(source, relPath, {
            warn: true,
            missingDepFlag,
          });
        }
        return { source, relPath };
      },
      onUnreadable: (relPath, err) =>
        this.warn(`skipped unreadable package file ${relPath}: ${String(err)}`),
    });

    for (const record of collected.outcomes) {
      if (record.outcome === 'empty') {
        this.warn(
          `include '${record.specifier}' resolved but discovered no component sources`
        );
      }
    }
    // external-package-file-discovery: silence is never an outcome — an
    // unresolvable include warns in non-strict mode and fails the build
    // under strict, naming every offending specifier (vite-plugin parity).
    const unresolvableMessage = unresolvableIncludesMessage(collected.outcomes);
    if (unresolvableMessage !== null) {
      if (this.options.strict) {
        throw new Error(unresolvableMessage);
      }
      this.warn(unresolvableMessage);
    }
    // first-class-extension D13: a stale dist entry under an extended package
    // rides the same strict/warn seam — a merge against it would silently
    // skew registry content the discovered sources no longer match
    // (vite-plugin parity).
    const staleDistMessage = staleDistIncludesMessage(collected.outcomes);
    if (staleDistMessage !== null) {
      if (this.options.strict) {
        throw new Error(staleDistMessage);
      }
      this.warn(staleDistMessage);
    }

    const packageMap = collected.packageMap;
    this.lastPackageMap = packageMap;
    this.externalDirOwners = collected.dirOwners;
    this.externalFileOwners = collected.fileOwners;
    this.externalSourceEntries = collected.sourceEntries;
    for (const entry of collected.entries) {
      const hash = contentHash(entry.source);
      this.fileCache.set(entry.path, { hash, source: entry.source });
      fileEntries.push({ path: entry.path, source: entry.source, hash });
    }

    this.externalPackageDirs = collected.packageDirs;

    // Publish external package state for non-owning compiler instances
    setSharedExternalDirs(collected.packageDirs);
    setSharedExternalEntries(collected.sourceEntries);

    bt.packageResolve = this.elapsed(t);

    // Step 5+: hand off to the shared analysis + emit core. Production pass
    // (devMode=false) writes system-props.js unconditionally and logs the
    // extraction report.
    await this.analyzeAndEmit(
      fileEntries,
      packageMap,
      false,
      bt,
      pipelineStart
    );
  }

  /**
   * Reset analysis state for HMR geological reset.
   */
  resetForHmr(): void {
    resetAnalysisPromise();
    this.lastCssHash = null;
    this.lastSystemPropsHash = null;
    this.lastManifestHash = null;
    this.lastAnalysisInputsHash = null;
    clearEngineCache(engineApi);
  }

  /**
   * Build file entries from cache: every cached file rides with full source.
   * The v2 engine has NO Rust-side cache (extract-v2-spine DEF-7: uncached
   * re-analysis beats a cache-hit path), so it must always receive full sources
   * (openspec: retire-extract-v1 removed the v1 empty-source cache contract).
   */
  private buildFileEntriesFromCache(): FileEntry[] {
    const entries: FileEntry[] = [];
    for (const [path, { hash, source }] of this.fileCache) {
      entries.push({ path, source, hash });
    }
    return entries;
  }

  /**
   * Run incremental pipeline with cache-aware file entries.
   * Reuses system config from the last full pipeline run.
   */
  private async runIncrementalPipeline(
    fileEntries: FileEntry[]
  ): Promise<void> {
    const bt: Record<string, number> = {};
    const pipelineStart = this.now();

    // Replay the FULL package map resolved during the last full pipeline;
    // the incremental pass never re-discovers external packages. Deriving it
    // from externalSourceEntries would silently drop dist-resolved packages
    // (those have no src/index.ts and live only in the package map).
    await this.analyzeAndEmit(
      fileEntries,
      this.lastPackageMap,
      true,
      bt,
      pipelineStart
    );
  }

  /**
   * Shared analysis + emit core for both pipelines — the single call site
   * that routes every manifest through the shared `runProjectAnalysis`,
   * reachable from both runFullPipeline (production) and
   * runIncrementalPipeline (HMR).
   *
   * Owns diagnostic surfacing, CSS assembly + styles.css write guard,
   * system-props module emit, and the timing log. The `devMode` flag is the
   * ONLY behavioral fork:
   *
   * - `false` (production): computes bt.analysis + logs the extraction
   *   report, and writes system-props.js UNCONDITIONALLY (no
   *   lastSystemPropsHash guard).
   * - `true` (HMR): skips the report log, and guards the system-props.js
   *   write by lastSystemPropsHash.
   *
   * The styles.css write guard (lastCssHash) is identical on both paths.
   */
  private async analyzeAndEmit(
    fileEntries: FileEntry[],
    packageMap: Record<string, string>,
    devMode: boolean,
    bt: Record<string, number>,
    pipelineStart: number
  ): Promise<void> {
    const system = this.system!;

    const analysisOptions = {
      fileEntries,
      packageMap,
      system,
      emitter: {
        runtimeImport: '@animus-ui/system/runtime',
        cssModuleId: ANIMUS_CSS_MODULE_ID,
        systemPropsModuleId:
          this.systemPropsModuleId ??
          join(this.rootDir!, '.animus', 'system-props.js'),
      },
      pathAliasesJson: this.pathAliasesJson,
      staticCssJson: this.staticCssJson,
      externalDirs: this.externalPackageDirs.map((dir) =>
        relative(this.rootDir!, dir)
      ),
      devMode,
    };

    const result = runProjectAnalysis(engineApi, {
      ...analysisOptions,
      warn: (message) => this.warn(message),
    });

    // Cross-source token contracts (extraction-diagnostics): engine
    // candidates × file ownership × source-token witness → the teaching
    // error naming token, component, package, and the missing
    // `createTheme().extend(...)`. Wiring and severity routing live in the
    // shared pipeline gate (vite-plugin parity by construction).
    enforceExternalTokenContracts({
      diagnostics: result.manifest?.diagnostics,
      fileOwners: this.externalFileOwners,
      dirOwners: this.externalDirOwners,
      sourceThemeManifestsJson: system.sourceThemeManifestsJson,
      strict: this.options.strict,
      prefix: '[animus-next]',
      warn: (message: string) => this.warn(message),
    });

    bt.jsonSerialize = result.timings.serializeMs;
    bt.rustExtract = result.timings.extractMs;
    bt.jsonParse = result.timings.parseMs;

    const manifest = result.manifest;

    if (!devMode) {
      bt.analysis =
        (bt.jsonSerialize ?? 0) + (bt.rustExtract ?? 0) + (bt.jsonParse ?? 0);
      if (manifest?.report) {
        this.log(
          `Extracted ${manifest.report.components_extracted ?? '?'}/${manifest.report.components_total ?? '?'} components (${bt.analysis}ms)`
        );
      }
    }

    // asset() placeholder substitution (global-styles-system) happens before
    // assembly so every consumer of the CSS (shared copy, disk artifact,
    // Turbopack hydration) receives substituted urls.
    const globalCss = this.substituteAssetReferences(result.globalCss, devMode);

    // Assemble full stylesheet (canonical order via shared function)
    const { declaration, variables, body } = assembleStylesheet({
      layers: this.options.layers,
      variableCss: system.variableCss,
      globalCss,
      componentCss: result.componentCss,
      split: true,
    });

    // Post-process the BODY only (spec: css-post-processing) — the @layer
    // declaration and variable CSS pass through untouched. Every consumer
    // (processAssets shared copy, disk artifact, Turbopack) receives the
    // processed bytes.
    if (this.lcssTargets === null) {
      this.lcssTargets = resolveLightningTargets(
        this.options.targets,
        this.rootDir!
      );
    }
    const processedBody = postProcessCss(body, {
      minify: this.options.minify ?? process.env.NODE_ENV === 'production',
      targets: this.lcssTargets,
      warnFn: (msg) => this.warn(msg),
    });

    const fullCss = [declaration, variables, processedBody]
      .filter(Boolean)
      .join('\n');

    // Store CSS in shared variable (authoritative source for processAssets)
    setSharedCss(fullCss);

    // Disk write serves as HMR trigger only — processAssets replaces content in-memory
    const cssHash = contentHash(fullCss);
    if (cssHash !== this.lastCssHash) {
      this.writeAnimusFile('styles.css', fullCss);
      this.lastCssHash = cssHash;
    }

    // Build system-props module for runtime resolution via the shared
    // generator (transforms resolve at extraction time in Rust).
    const systemPropsContent = buildSystemPropsModule({
      systemPropMapJson: JSON.stringify(manifest?.system_prop_map ?? {}),
      groupRegistryJson: system.groupRegistryJson,
      dynamicProps: (manifest?.dynamic_props ?? {}) as Record<
        string,
        DynamicPropMeta
      >,
    });

    setSharedSystemProps(systemPropsContent);

    if (devMode) {
      // HMR: skip the disk write when byte-identical to the last one written.
      const systemPropsHash = contentHash(systemPropsContent);
      if (systemPropsHash !== this.lastSystemPropsHash) {
        this.writeAnimusFile('system-props.js', systemPropsContent);
        this.lastSystemPropsHash = systemPropsHash;
      }
    } else {
      // Production: write unconditionally (no lastSystemPropsHash guard).
      this.writeAnimusFile('system-props.js', systemPropsContent);
    }

    // Store manifest for loader
    setManifestJson(result.manifestJson);

    // Disk manifest artifact (spec: next-turbopack-integration) — the
    // loader-visible contract for bundlers without shared process memory.
    // Written in both modes, hash-guarded like system-props.
    const manifestHash = contentHash(result.manifestJson);
    if (this.lastManifestHash === null) {
      this.lastManifestHash = this.diskArtifactHash('manifest.json');
    }
    if (manifestHash !== this.lastManifestHash) {
      this.writeAnimusFile('manifest.json', result.manifestJson);
      this.lastManifestHash = manifestHash;
    }

    // Hydration artifact for isolated Turbopack loader workers — the exact
    // analyze-time input set, replayable via buildAnalyzeProjectArgs. Reuses
    // the inputs runProjectAnalysis already built (the filesJson inside them
    // carries the whole source corpus — never serialize it twice).
    if (this.persistAnalysisInputs) {
      const inputsJson = JSON.stringify(result.inputs);
      const inputsHash = contentHash(inputsJson);
      if (this.lastAnalysisInputsHash === null) {
        this.lastAnalysisInputsHash = this.diskArtifactHash(
          'analysis-inputs.json'
        );
      }
      if (inputsHash !== this.lastAnalysisInputsHash) {
        this.writeAnimusFile('analysis-inputs.json', inputsJson);
        this.lastAnalysisInputsHash = inputsHash;
      }
    }

    bt.total = this.elapsed(pipelineStart);
    logBuildTimings(bt, manifest?.timing, (msg) => this.log(msg), this.verbose);
  }

  /** Content hash of an existing `.animus/` artifact, or null when absent or
   *  unreadable. Seeds a null write guard so a FRESH session never rewrites a
   *  byte-identical artifact (spec: next-turbopack-integration — a rewrite
   *  changes mtime/inode and needlessly re-keys Turbopack loader-worker
   *  hydration). */
  private diskArtifactHash(name: string): string | null {
    try {
      return contentHash(
        readFileSync(join(this.rootDir!, '.animus', name), 'utf-8')
      );
    } catch {
      return null;
    }
  }

  /** Ensure `.animus/` exists and write one generated artifact into it.
   *  Write-then-rename so cross-process readers (Turbopack loader workers)
   *  can never observe a torn half-written file. The tmp name carries the
   *  pid — Next dev evaluates the config in more than one process, and two
   *  sessions writing the same artifact must not race on one tmp path. */
  private writeAnimusFile(name: string, content: string): void {
    const dir = join(this.rootDir!, '.animus');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = join(dir, `.${name}.${process.pid}.tmp`);
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, join(dir, name));
  }

  /**
   * asset() placeholder substitution (global-styles-system): resolve each
   * referenced specifier through Node resolution, copy the bytes into
   * `.animus/assets/` under a content-hashed name, and substitute a
   * RELATIVE url. `.animus/styles.css` is processed by Next's own CSS
   * pipeline (webpack and Turbopack alike), which applies its native asset
   * handling — publicPath and output hashing — to relative url()
   * references. Unsubstitutable specifiers warn and emit literally in
   * non-strict mode, fail the build under `strict: true`.
   */
  private substituteAssetReferences(
    globalCss: string,
    devMode: boolean
  ): string {
    const specifiers = findAssetSpecifiers(globalCss);
    const assetsDir = join(this.rootDir!, '.animus', 'assets');
    const expected = new Set<string>();
    this.assetDependencyPaths.clear();
    this.assetDependencyKeys.clear();

    const urlBySpecifier = new Map<string, string>();
    for (const specifier of specifiers) {
      // This runs per HMR rebuild; the resolve/read/hash/copy result is
      // stable for the lifetime of a loaded system, so a memo (cleared on
      // system load) reduces steady-state passes to one existsSync each.
      // A missing copy (concurrent prune) falls through and self-heals.
      const cached = this.assetCopyCache.get(specifier);
      if (cached && existsSync(join(assetsDir, cached.fileName))) {
        try {
          const current = statSync(cached.sourcePath);
          if (
            current.mtimeMs === cached.mtimeMs &&
            current.size === cached.size
          ) {
            this.trackAssetDependency(cached.sourcePath);
            expected.add(cached.fileName);
            urlBySpecifier.set(specifier, cached.url);
            continue;
          }
        } catch {
          // Re-resolve below; strict/non-strict policy remains centralized.
        }
      }
      const resolvedPath = this.resolveAssetSpecifier(specifier);
      if (!resolvedPath) {
        const message = `unresolvable asset() specifier: ${specifier}`;
        if (this.options.strict) throw new Error(`[animus-next] ${message}`);
        this.warn(message);
        urlBySpecifier.set(specifier, specifier);
        continue;
      }
      const bytes = readFileSync(resolvedPath);
      const sourceStat = statSync(resolvedPath);
      this.trackAssetDependency(resolvedPath);
      const ext = extname(resolvedPath);
      const stem = basename(resolvedPath, ext);
      const fileName = `${stem}.${contentHash(bytes).slice(0, 8)}${ext}`;
      expected.add(fileName);
      if (!existsSync(assetsDir)) {
        mkdirSync(assetsDir, { recursive: true });
      }
      const assetPath = join(assetsDir, fileName);
      if (!existsSync(assetPath)) {
        writeFileSync(assetPath, bytes);
      }
      const url = `./assets/${fileName}`;
      urlBySpecifier.set(specifier, url);
      this.assetCopyCache.set(specifier, {
        sourcePath: resolvedPath,
        mtimeMs: sourceStat.mtimeMs,
        size: sourceStat.size,
        fileName,
        url,
      });
    }

    // Content-hashed copies are never overwritten, so superseded revisions
    // (and copies of assets no longer referenced at all) accumulate without
    // this sync — runs AFTER the writes so the current set is always on
    // disk, including when no asset() remains and everything is stale.
    if (!devMode) pruneStaleAssets(assetsDir, expected);

    return substituteAssetPlaceholders(globalCss, urlBySpecifier);
  }

  private trackAssetDependency(path: string): void {
    this.assetDependencyPaths.add(path);
    for (const key of toWatchKeys(path)) this.assetDependencyKeys.add(key);
  }

  /**
   * Resolve an asset specifier to an absolute file via the shared pipeline
   * resolver (host aliases → Node resolution → package root), with one
   * session-local last resort: an already-discovered source entry's package
   * root (dist-less workspace kits the shared resolver cannot see).
   */
  private resolveAssetSpecifier(specifier: string): string | null {
    const resolved = resolveAssetFile(
      specifier,
      this.rootDir!,
      this.pathAliasesJson
    );
    if (resolved) return resolved;

    const segments = specifier.split('/');
    const packageName = specifier.startsWith('@')
      ? segments.slice(0, 2).join('/')
      : segments[0];
    const subpath = specifier.slice(packageName.length + 1);
    if (!subpath) return null;
    const sourceEntry =
      this.externalSourceEntries.get(packageName) ??
      [...this.externalSourceEntries].find(
        ([declared]) =>
          declared === packageName || declared.startsWith(`${packageName}/`)
      )?.[1];
    if (sourceEntry) {
      const candidate = join(findPackageRoot(sourceEntry), subpath);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
}

/**
 * Sync `.animus/assets/` to the current build's content-hashed file set:
 * anything else in the directory is a superseded revision (the copies are
 * content-addressed and never overwritten) or the leftover of an asset()
 * reference that no longer exists. Failures are tolerated per entry — Next
 * dev evaluates the config in more than one process, and a concurrent
 * session may have removed (or be about to rewrite) the same file; every
 * pass rewrites whatever of its own set is missing, so races self-heal.
 */
export function pruneStaleAssets(
  assetsDir: string,
  expected: ReadonlySet<string>
): void {
  if (!existsSync(assetsDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(assetsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (expected.has(entry)) continue;
    try {
      unlinkSync(join(assetsDir, entry));
    } catch {
      // Concurrent session removal, or an unexpected subdirectory — leave it.
    }
  }
}
