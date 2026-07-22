import {
  applyPrefix,
  applyUnitFallback,
  assembleStylesheet,
  assertNoRetiredEngineSelection,
  buildAnalyzeProjectArgs,
  buildDynamicPropConfig,
  buildPathAliasesJson,
  collectExternalPackageSources,
  contentHash,
  DEFAULT_EXTENSIONS,
  discoverFiles,
  extractSystemFilePackages,
  formatRustTimingWaterfall,
  preprocessMdx,
  surfaceManifestDiagnostics,
} from '@animus-ui/extract/pipeline';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { extname, join, relative, resolve } from 'path';

import {
  getAnalysisPromise,
  getSharedCss,
  getSharedExternalDirs,
  getSharedExternalEntries,
  resetAnalysisPromise,
  setAnalysisPromise,
  setManifestJson,
  setSharedCss,
  setSharedExternalDirs,
  setSharedExternalEntries,
  setSharedSystemProps,
  engineApi,
  setSharedEngine,
} from './singleton';

import type { AnimusNextOptions } from './types';
import type { DynamicPropMeta } from '@animus-ui/extract/pipeline';

type WebpackSource = {
  source(): string | Buffer;
  size(): number;
};

type Compilation = {
  hooks: {
    processAssets: {
      tap: (
        options: { name: string; stage: number },
        fn: (assets: Record<string, WebpackSource>) => void
      ) => void;
    };
  };
  getAsset(name: string): { source: WebpackSource } | undefined;
  updateAsset(name: string, newSource: WebpackSource): void;
};

type Compiler = {
  hooks: {
    run: {
      tapPromise: (name: string, fn: (c: Compiler) => Promise<void>) => void;
    };
    watchRun: {
      tapPromise: (name: string, fn: (c: Compiler) => Promise<void>) => void;
    };
    compilation: {
      tap: (name: string, fn: (compilation: Compilation) => void) => void;
    };
  };
  context: string;
  /** Present on watchRun compilers after the first compilation (webpack 5). */
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
  options?: {
    name?: string;
    resolve?: {
      alias?: Record<string, string | string[] | false>;
    };
  };
  webpack?: {
    Compilation: {
      PROCESS_ASSETS_STAGE_ADDITIONAL: number;
    };
    sources: {
      RawSource: new (source: string) => WebpackSource;
    };
  };
};

const PLUGIN_NAME = 'AnimusWebpackPlugin';

/**
 * Module id the Rust emitter injects for the extracted stylesheet — also the
 * exact resolve.alias key with-animus registers for it, which extractAliases
 * must skip when harvesting consumer aliases.
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

export class AnimusWebpackPlugin {
  private options: AnimusNextOptions;
  private rootDir: string | null = null;

  // System config (loaded once via NAPI)
  private configJson = '';
  private groupRegistryJson = '';
  private themeJson = '';
  private variableMapJson = '';
  private variableCss = '';
  private contextualVarsJson: string | null = null;
  private selectorAliasesJson: string | null = null;
  private globalCss = '';
  private globalStyleBlocksJson: string | null = null;
  private keyframesBlocksJson: string | null = null;
  private pathAliasesJson: string | null = null;

  // File tracking for HMR
  private fileCache = new Map<string, { hash: string; source: string }>();
  private lastCssHash: string | null = null;
  private lastSystemPropsHash: string | null = null;

  // Absolute directory prefixes for external DS packages (for loader allowlisting)
  private externalPackageDirs: string[] = [];

  // Map of external package specifier → absolute source entry path (for webpack resolve alias)
  private externalSourceEntries = new Map<string, string>();

  constructor(options: AnimusNextOptions) {
    this.options = options;
    // v2 is the only engine (openspec: retire-extract-v1). Reject a retired v1
    // selection loudly before publishing the shared choice — the option type no
    // longer admits 'v1', so cast to string to still catch a stale config or an
    // ANIMUS_ENGINE=v1 override at runtime.
    assertNoRetiredEngineSelection(options.engine as string | undefined);
    setSharedEngine(options.engine ?? 'v2');
  }

  private get verbose(): boolean {
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

  private logBuildTimings(
    bt: Record<string, number>,
    rustTiming: Record<string, number> | undefined
  ): void {
    if (!this.verbose) return;
    const pad = (label: string, width: number): string =>
      label + ' '.repeat(Math.max(0, width - label.length));
    const jsPhases: [string, string][] = [
      ['systemLoad', 'system-load'],
      ['fileDiscovery', 'file-discovery'],
      ['fileRead', 'file-read+hash'],
      ['packageResolve', 'pkg-resolve'],
      ['analysis', 'analysis'],
    ];
    for (const [key, label] of jsPhases) {
      const ms = bt[key] ?? 0;
      if (ms === 0 && !Object.hasOwn(bt, key)) continue;
      this.log(`  ${pad(label, 17)}${String(ms).padStart(5)}ms`);

      if (key === 'analysis') {
        for (const [sk, sl] of [
          ['jsonSerialize', 'json-serialize'],
          ['rustExtract', 'rust-extract'],
          ['jsonParse', 'json-parse'],
        ] as const) {
          const sms = bt[sk] ?? 0;
          this.log(`    ${pad(sl, 15)}${String(sms).padStart(5)}ms`);

          if (sk === 'rustExtract' && rustTiming) {
            for (const line of formatRustTimingWaterfall(rustTiming, {
              indent: '      ',
              labelWidth: 13,
            })) {
              this.log(line);
            }
          }
        }
      }
    }
    this.log(`  total             ${String(bt.total).padStart(5)}ms`);

    if (process.env.ANIMUS_TIMING_JSON === '1') {
      const merged: Record<string, number> = {};
      for (const [k, v] of Object.entries(bt)) {
        merged[`buildStart.${k}`] = v;
      }
      if (rustTiming) {
        for (const [k, v] of Object.entries(rustTiming)) {
          if (typeof v === 'number') merged[`rust.${k}`] = v;
        }
      }
      console.info(`[animus:timing] ${JSON.stringify(merged)}`);
    }
  }

  private initialized = false;
  private aliasesExtracted = false;

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

  /** Extract path aliases from webpack's resolve.alias config. Runs once per
   *  plugin instance — the resolve config is immutable after apply. */
  private extractAliases(compiler: Compiler): void {
    if (this.aliasesExtracted) return;
    this.aliasesExtracted = true;
    const rootDir = compiler.context;
    const rawAlias = compiler.options?.resolve?.alias;
    if (!rawAlias || typeof rawAlias !== 'object') return;

    // Webpack alias is Record<string, string | string[] | false>
    const pairs: Array<{ pattern: string; target: string }> = [];
    for (const [key, value] of Object.entries(rawAlias)) {
      const target = Array.isArray(value) ? value[0] : value;
      if (typeof target !== 'string') continue;
      // Skip exactly the alias with-animus injected for the emitter's CSS
      // import — a consumer alias merely containing '.animus' must survive.
      if (key === ANIMUS_CSS_MODULE_ID) continue;
      pairs.push({ pattern: key, target });
    }

    const built = buildPathAliasesJson(pairs, rootDir);
    if (built) {
      this.pathAliasesJson = built.json;
    }
  }

  apply(compiler: Compiler): void {
    // Edge compiler has no CSS dependencies — skip entirely
    if (compiler.options?.name === 'edge-server') return;

    // processAssets: inject shared CSS into the .animus/styles.css asset in-memory.
    // This fires per-compilation for every compiler, ensuring all get correct CSS
    // regardless of which instance ran the extraction pipeline.
    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation: Compilation) => {
      const stage =
        compiler.webpack?.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL ?? -2000;
      const RawSource = compiler.webpack?.sources.RawSource;
      compilation.hooks.processAssets.tap({ name: PLUGIN_NAME, stage }, () => {
        const css = getSharedCss();
        if (!css || !RawSource) return;

        // Try absolute path first, then relative — asset name depends on
        // how webpack resolved the .animus/styles.css import
        const rootDir = this.rootDir || compiler.context;
        const cssPath = join(rootDir, '.animus', 'styles.css');
        if (compilation.getAsset(cssPath)) {
          compilation.updateAsset(cssPath, new RawSource(css));
          return;
        }
        if (compilation.getAsset(ANIMUS_CSS_MODULE_ID)) {
          compilation.updateAsset(ANIMUS_CSS_MODULE_ID, new RawSource(css));
        }
      });
    });

    // Production build: run once
    compiler.hooks.run.tapPromise(PLUGIN_NAME, async (_compiler: Compiler) => {
      this.rootDir = _compiler.context;
      this.extractAliases(_compiler);

      const existing = getAnalysisPromise();
      if (existing) {
        await existing;
        return;
      }

      const promise = this.runFullPipeline();
      setAnalysisPromise(promise);
      await promise;
    });

    // Dev watch: first run = full pipeline, subsequent = incremental
    compiler.hooks.watchRun.tapPromise(
      PLUGIN_NAME,
      async (_compiler: Compiler) => {
        this.rootDir = _compiler.context;
        this.extractAliases(_compiler);

        if (!this.initialized) {
          const existing = getAnalysisPromise();
          if (existing) {
            await existing;
            this.initialized = true;
            return;
          }

          const promise = this.runFullPipeline();
          setAnalysisPromise(promise);
          await promise;
          this.initialized = true;
          return;
        }

        // Incremental: detect changes and re-analyze if needed
        await this.handleWatchUpdate(_compiler);
      }
    );
  }

  private async handleWatchUpdate(compiler: Compiler): Promise<void> {
    // Guard: if system state was never loaded (non-owning instance that
    // skipped runFullPipeline), skip — processAssets reads from shared variable
    if (this.configJson === '') return;

    const rootDir = this.rootDir!;
    const resolvedSystemPath = resolve(rootDir, this.options.system);

    // Check for geological reset: system file changed
    try {
      const systemSource = readFileSync(resolvedSystemPath, 'utf-8');
      const systemRelPath = relative(rootDir, resolvedSystemPath);
      const cached = this.fileCache.get(systemRelPath);
      const currentHash = contentHash(systemSource);

      if (cached && cached.hash !== currentHash) {
        // Geological reset: system file changed
        this.resetForHmr();
        this.initialized = false;
        const promise = this.runFullPipeline();
        setAnalysisPromise(promise);
        await promise;
        this.initialized = true;
        return;
      }
    } catch (err) {
      // Not a benign probe: this wraps the system-file read and the
      // geological-reset re-run. Swallowing keeps a transient read failure
      // from crashing the watch loop, but a real fault must stay diagnosable.
      this.warn(`HMR geological-reset check failed: ${String(err)}`);
    }

    // Check for component file changes using content-hash diffing
    const { excludePatterns, extensionsSet, shouldHandleMdx } =
      this.resolveScanConfig();

    // Prune deleted/renamed files so their last-known source stops riding
    // along as a ghost entry on every subsequent incremental analysis.
    let removedAny = false;
    if (compiler.removedFiles) {
      for (const removedPath of compiler.removedFiles) {
        const rel = relative(rootDir, removedPath);
        // MDX cache keys carry the preprocessed `.tsx` suffix.
        if (this.fileCache.delete(rel) || this.fileCache.delete(rel + '.tsx')) {
          removedAny = true;
        }
      }
    }

    // Restrict the read+hash pass to webpack's modified set when available
    // (watchRun provides it after the first compilation); fall back to a full
    // discovery walk otherwise. Filters mirror discoverFiles: extension
    // allowlist plus substring exclude patterns on both path forms.
    let files: string[];
    if (compiler.modifiedFiles) {
      files = [];
      for (const modifiedPath of compiler.modifiedFiles) {
        if (!extensionsSet.has(extname(modifiedPath))) continue;
        const rel = relative(rootDir, modifiedPath);
        if (rel.startsWith('..')) continue;
        if (
          excludePatterns.some(
            (pattern) =>
              modifiedPath.includes(pattern) || rel.includes(pattern)
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
        // read — it will surface in removedFiles on the next watchRun.
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

    if (changedPaths.length > 0 || removedAny) {
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

  private async runFullPipeline(): Promise<void> {
    const pipelineStart = this.now();
    const bt: Record<string, number> = {};

    // Clear Rust-side per-file cache so stale results from a prior
    // build never bleed into a fresh pipeline run.
    try {
      const { clearAnalysisCache } = engineApi();
      clearAnalysisCache();
    } catch {
      // Benign optional-capability probe: clearAnalysisCache is absent on
      // older engine builds — nothing to clear, so ignore.
    }

    const rootDir = this.rootDir!;
    const resolvedSystemPath = resolve(rootDir, this.options.system);

    // Step 1: Load system via NAPI
    let t = this.now();
    this.loadSystem(rootDir, resolvedSystemPath);
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
    // walk + require.resolve stays here (the bundler-specific seam); the
    // traversal/ingest below is the shared collector
    // (spec: external-package-file-discovery).
    t = this.now();
    const packageNames = extractSystemFilePackages(resolvedSystemPath);
    const preResolved = this.resolvePackagesByName(rootDir, packageNames);

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
        this.warn(
          `skipped unreadable package file ${relPath}: ${String(err)}`
        ),
    });

    const packageMap = collected.packageMap;
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

  private loadSystem(rootDir: string, systemPath: string): void {
    const { loadSystemModule } = engineApi();
    const config = loadSystemModule(systemPath, rootDir);

    this.configJson = config.propConfig;
    this.groupRegistryJson = config.groupRegistry;
    this.themeJson = config.scalesJson;
    this.variableMapJson = config.variableMapJson;
    this.variableCss = config.variableCss;
    this.contextualVarsJson = config.contextualVarsJson;
    this.selectorAliasesJson = config.selectorAliases || null;

    if (this.options.prefix) {
      const prefixed = applyPrefix(
        this.options.prefix,
        this.variableMapJson,
        this.variableCss,
        this.themeJson,
        this.contextualVarsJson || undefined
      );
      this.variableMapJson = prefixed.variableMapJson;
      this.variableCss = prefixed.variableCss;
      if (prefixed.themeJson) this.themeJson = prefixed.themeJson;
      if (prefixed.contextualVarsJson)
        this.contextualVarsJson = prefixed.contextualVarsJson;
    }

    // Store raw global style blocks for Rust-side resolution in analyzeProject.
    this.globalStyleBlocksJson = config.globalStyleBlocks || null;
    this.keyframesBlocksJson = config.keyframesBlocks || null;
  }

  private resolvePackagesByName(
    rootDir: string,
    names: string[]
  ): Record<string, string> {
    if (names.length === 0) return {};

    const nameSet = new Set(names);
    const resolved = new Set<string>();
    const packageMap: Record<string, string> = {};

    // Pass 1: workspace resolution
    try {
      const rootPkg = JSON.parse(
        readFileSync(join(rootDir, 'package.json'), 'utf-8')
      );
      const workspaces: string[] = rootPkg.workspaces || [];

      for (const ws of workspaces) {
        const wsDir = resolve(rootDir, ws);
        if (!existsSync(wsDir)) continue;

        try {
          const pkg = JSON.parse(
            readFileSync(join(wsDir, 'package.json'), 'utf-8')
          );
          const name: string = pkg.name || '';

          if (nameSet.has(name)) {
            const main = pkg.main || pkg.module || 'index.ts';
            const entryPath = resolve(wsDir, main);
            if (existsSync(entryPath)) {
              packageMap[name] = relative(rootDir, entryPath);
              resolved.add(name);
            }
          }
        } catch {
          // Benign existence probe: a workspace entry without a readable
          // package.json simply contributes no package — skip it.
        }
      }
    } catch {
      // Benign existence probe: no readable root package.json means no
      // workspace resolution; Pass 2 (require.resolve) still runs.
    }

    // Pass 2: require.resolve fallback for non-workspace packages
    for (const name of nameSet) {
      if (resolved.has(name)) continue;
      try {
        const entryPath = require.resolve(name, { paths: [rootDir] });
        packageMap[name] = relative(rootDir, entryPath);
      } catch {
        // Benign resolution probe: require.resolve throws for an
        // unresolvable specifier — that package just goes unmapped.
      }
    }

    return packageMap;
  }

  /**
   * Reset analysis state for HMR geological reset.
   */
  resetForHmr(): void {
    resetAnalysisPromise();
    this.lastCssHash = null;
    this.lastSystemPropsHash = null;
    try {
      const { clearAnalysisCache } = engineApi();
      clearAnalysisCache();
    } catch {
      // Benign optional-capability probe: clearAnalysisCache is absent on
      // older engine builds — nothing to clear, so ignore.
    }
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
  private async runIncrementalPipeline(fileEntries: FileEntry[]): Promise<void> {
    const rootDir = this.rootDir!;
    const bt: Record<string, number> = {};
    const pipelineStart = this.now();

    // Replay the package map resolved during the last full pipeline (from
    // cache); the incremental pass never re-discovers external packages.
    const packageMap: Record<string, string> = Object.fromEntries(
      Array.from(this.externalSourceEntries).map(([spec, entry]) => [
        spec,
        relative(rootDir, entry),
      ])
    );

    // Hand off to the shared analysis + emit core. HMR pass (devMode=true)
    // guards the system-props.js write by lastSystemPropsHash.
    await this.analyzeAndEmit(fileEntries, packageMap, true, bt, pipelineStart);
  }

  /**
   * Shared analysis + emit core for both pipelines — the single call site
   * that routes every manifest through surfaceManifestDiagnostics, reachable
   * from both runFullPipeline (production) and runIncrementalPipeline (HMR).
   *
   * Owns the NAPI serialize/call/parse, diagnostic surfacing, CSS assembly +
   * styles.css write guard, dynamic-prop config, system-props module emit,
   * and timing log. The `devMode` flag is the ONLY behavioral fork:
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
    const { analyzeProject } = engineApi();
    const emitterConfig = JSON.stringify({
      runtime_import: '@animus-ui/system/runtime',
      css_module_id: ANIMUS_CSS_MODULE_ID,
      system_props_module_id: join(this.rootDir!, '.animus', 'system-props.js'),
    });

    // Sub-phase: JSON serialize
    let t = this.now();
    const fileEntriesJson = JSON.stringify(fileEntries);
    const packageMapJson = JSON.stringify(packageMap);
    bt.jsonSerialize = this.elapsed(t);

    // Sub-phase: NAPI call. Production vs HMR differ only in the devMode
    // flag baked into the positional arg tuple.
    t = this.now();
    const manifestJson: string = analyzeProject(
      ...buildAnalyzeProjectArgs({
        devMode,
        filesJson: fileEntriesJson,
        scalesJson: this.themeJson,
        variableMapJson: this.variableMapJson,
        contextualVarsJson: this.contextualVarsJson || null,
        propConfigJson: this.configJson,
        groupRegistryJson: this.groupRegistryJson,
        packageResolutionJson: packageMapJson,
        emitterConfigJson: emitterConfig,
        selectorAliasesJson: this.selectorAliasesJson,
        globalStyleBlocksJson: this.globalStyleBlocksJson,
        pathAliasesJson: this.pathAliasesJson,
        keyframesJson: this.keyframesBlocksJson,
      })
    );
    bt.rustExtract = this.elapsed(t);

    // Sub-phase: JSON parse
    t = this.now();
    const manifest = JSON.parse(manifestJson);
    surfaceManifestDiagnostics(manifest, (message) => this.warn(message));
    bt.jsonParse = this.elapsed(t);

    if (!devMode) {
      bt.analysis =
        (bt.jsonSerialize ?? 0) + (bt.rustExtract ?? 0) + (bt.jsonParse ?? 0);
      if (manifest?.report) {
        this.log(
          `Extracted ${manifest.report.components_extracted ?? '?'}/${manifest.report.components_total ?? '?'} components (${bt.analysis}ms)`
        );
      }
    }

    // Populate globalCss from Rust-resolved sheets
    this.globalCss = manifest?.sheets?.global || '';

    // CSS from Rust is fully resolved — transforms evaluated in-process via boa_engine.
    let componentCss: string = manifest?.css || '';
    componentCss = applyUnitFallback(componentCss);

    // Assemble full stylesheet (canonical order via shared function)
    const { declaration, variables, body } = assembleStylesheet({
      layers: this.options.layers,
      variableCss: this.variableCss,
      globalCss: this.globalCss,
      componentCss,
      split: true,
    });
    const fullCss = [declaration, variables, body].filter(Boolean).join('\n');

    // Store CSS in shared variable (authoritative source for processAssets)
    setSharedCss(fullCss);

    // Disk write serves as HMR trigger only — processAssets replaces content in-memory
    const cssHash = contentHash(fullCss);
    if (cssHash !== this.lastCssHash) {
      this.writeAnimusFile('styles.css', fullCss);
      this.lastCssHash = cssHash;
    }

    // Build system-props module for runtime resolution.
    // Transforms are resolved at extraction time via boa_engine in Rust;
    // runtime transform functions are not yet supported for dynamic props.
    const systemPropMap = JSON.stringify(manifest?.system_prop_map ?? {});
    const dynamicProps = (manifest?.dynamic_props ?? {}) as Record<
      string,
      DynamicPropMeta
    >;
    const dynamicPropConfig = buildDynamicPropConfig(dynamicProps);

    const systemPropsContent =
      `export const systemPropMap = ${systemPropMap};\n` +
      `export const systemPropGroups = ${this.groupRegistryJson};\n` +
      `export const dynamicPropConfig = ${JSON.stringify(dynamicPropConfig)};\n` +
      `export const transforms = {};\n`;

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
    setManifestJson(manifestJson);

    bt.total = this.elapsed(pipelineStart);
    this.logBuildTimings(bt, manifest?.timing);
  }

  /** Ensure `.animus/` exists and write one generated artifact into it. */
  private writeAnimusFile(name: string, content: string): void {
    const dir = join(this.rootDir!, '.animus');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(join(dir, name), content);
  }

  /** Expose options for the loader */
  getOptions(): AnimusNextOptions {
    return this.options;
  }

  /** Expose external package directories for webpack loader allowlisting.
   *  Falls back to shared globalThis state for non-owning compiler instances. */
  getExternalPackageDirs(): string[] {
    return this.externalPackageDirs.length > 0
      ? this.externalPackageDirs
      : getSharedExternalDirs();
  }

  /** Expose external package source entries for webpack resolve alias.
   *  Falls back to shared globalThis state for non-owning compiler instances. */
  getExternalSourceEntries(): Map<string, string> {
    return this.externalSourceEntries.size > 0
      ? this.externalSourceEntries
      : getSharedExternalEntries();
  }
}
