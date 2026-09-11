import {
  assertNoErrorDiagnostics,
  buildSystemPropsModule,
  contentHash,
  createExcludeMatcher,
  createV2EngineApi,
  DEFAULT_EXTENSIONS,
  clearEngineCache,
  diffFilePlans,
  enforceExternalTokenContracts,
  createSourceCorpus,
  findAssetSpecifiers,
  formatRustTimingWaterfall,
  loadSystemConfig,
  vocabularyWitnessDiagnostics,
  parseFilesJson,
  projectExternalFileOwners,
  resolveAssetFile,
  runProjectAnalysis,
  serializeStaticCss,
  snapshotFilePlans,
  staleDistIncludesMessage,
  substituteAssetPlaceholders,
  toWatchKeys,
  unresolvableIncludesMessage,
  runStructuralSelfCheck,
} from '@animus-ui/extract/pipeline';
import { relative, resolve } from 'path';

import {
  RESOLVED_COMPONENTS_ID,
  RESOLVED_CSS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
  VIRTUAL_CSS_ID,
} from './constants';
import { HotUpdateEvents } from './hot-update-events';
import { invalidateFileModules } from './module-invalidation';
import { ResetCoalescer } from './reset-coalescer';

import type { LightningTargets } from './css';
import type { AnimusExtractOptions } from './index';
import type {
  ExcludeMatcher,
  ExternalPackageOutcome,
  ManifestDiagnostic,
  ManifestSheets,
  ProjectAnalysisResult,
  ProjectManifest,
  RawSourceEntry,
  SourceCorpus,
  SourceIngestionResult,
  SystemConfig,
  V2ExtractEngine,
} from '@animus-ui/extract/pipeline';
import type { Logger } from 'vite';

function emptySystemConfig(): SystemConfig {
  return {
    propConfigJson: '{}',
    groupRegistryJson: '{}',
    scalesJson: '{}',
    variableMapJson: '{}',
    variableCss: '',
    contextualVarsJson: '{}',
    selectorAliasesJson: null,
    globalStyleBlocksJson: null,
    keyframesJson: null,
  };
}

// Serializes analysis transactions per context: two interleaved
// ingest→analyze→publish sections publish from different cache snapshots.
const analysisChains = new WeakMap<PluginContext, Promise<void>>();

/** Runs `task` after every analysis transaction already scheduled for this
 *  context. Entry points only — a nested call waits on its own chain. */
export function runExclusiveAnalysis<T>(
  ctx: PluginContext,
  task: () => Promise<T>
): Promise<T> {
  const chain = analysisChains.get(ctx) ?? Promise.resolve();
  const result = chain.then(task);
  analysisChains.set(
    ctx,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}

function generateSystemPropsModule(ctx: PluginContext): string {
  return buildSystemPropsModule({
    systemPropMapJson: ctx.storedSystemPropMapJson,
    groupRegistryJson: ctx.system.groupRegistryJson,
    dynamicProps: JSON.parse(ctx.storedDynamicPropsJson),
    transformsSource: ctx.storedTransformsSource,
  });
}

/** Memoized on the inputs themselves, so no writer owes the memo a refresh
 *  and a stale memo cannot serve a module from a generation that is gone. */
const systemPropsModules = new WeakMap<
  PluginContext,
  { key: string; source: string }
>();

/** NUL cannot appear in JSON text, so concatenation is injective. */
function systemPropsModuleKey(ctx: PluginContext): string {
  return [
    ctx.storedSystemPropMapJson,
    ctx.system.groupRegistryJson,
    ctx.storedDynamicPropsJson,
    ctx.storedTransformsSource,
  ].join('\u0000');
}

/** The exact source `virtual:animus/system-props` serves now — one definition,
 *  so the served bytes and the HMR change decision cannot diverge. */
export function systemPropsModuleSource(ctx: PluginContext): string {
  const key = systemPropsModuleKey(ctx);
  const memo = systemPropsModules.get(ctx);
  if (memo && memo.key === key) return memo.source;
  const source = generateSystemPropsModule(ctx);
  systemPropsModules.set(ctx, { key, source });
  return source;
}

/** Drop a deleted or renamed-away raw original from the dev file cache.
 *  Generated MDX/Svelte children live only in the published corpus. */
export function pruneFileCache(
  cache: Map<string, { hash: string; source: string }>,
  rootDir: string,
  absPath: string
): boolean {
  const rel = relative(rootDir, resolve(absPath));
  return cache.delete(rel);
}

export class PluginContext {
  readonly options: AnimusExtractOptions;
  readonly verbose: boolean;
  readonly staticCssJson: string | null;

  isProd = false;
  /** Emission mode (the explicit `mode` option wins over the command); feeds
   *  engine devMode and the minify default. Lifecycle stays on `isProd`. */
  emissionProd = false;
  rootDir = '';
  logger: Logger | null = null;

  system: SystemConfig = emptySystemConfig();

  lcssTargets: LightningTargets = {};

  pathAliasesJson: string | null = null;

  extensionsSet: ReadonlySet<string>;

  excludeMatcher: ExcludeMatcher;

  // `null` means no analysis has published yet; a failed analysis leaves the
  // previous manifest current instead of clearing it.
  storedManifest: ProjectManifest | null = null;
  storedManifestJson = '';

  globalCss = '';
  resolvedComponentCss = '';
  storedSheets: ManifestSheets | null = null;

  layerDeclaration = '';

  transformOutputHashes = new Map<string, string>();

  recordTransformOutput(relativePath: string, code: string): void {
    this.transformOutputHashes.set(relativePath, contentHash(code));
  }

  /** Vocabulary witnesses from the sealed system, awaiting the next analysis.
   *  Surfacing happens only inside `runProjectAnalysis`. */
  systemVocabularyDiagnostics: ManifestDiagnostic[] = [];

  reverseProvenance: Record<string, string[]> = {};

  storedSystemPropMapJson = '{}';
  storedDynamicPropsJson = '{}';
  storedTransformsSource = '{}';

  readonly fileCache: ReadonlyMap<string, { hash: string; source: string }> =
    new Map();

  /** Mutation attempts against `fileCache`, for memos that must not key on
   *  `size` — a delete plus an unrelated create leaves it unchanged. */
  fileCacheGeneration = 0;

  /** The one mutator of the raw-source cache: every add, replacement and
   *  deletion goes through here so no write escapes the counter above. */
  mutateFileCache<T>(
    mutate: (cache: Map<string, { hash: string; source: string }>) => T
  ): T {
    // SAFETY: `fileCache` is a Map typed as ReadonlyMap so writes funnel here;
    // this is the one place allowed to write it, and it bumps the counter.
    const cache = this.fileCache as Map<
      string,
      { hash: string; source: string }
    >;
    const result = mutate(cache);
    this.fileCacheGeneration += 1;
    return result;
  }

  /** Generated MDX/Svelte paths never enter `fileCache` — they live only in
   *  this corpus's published projection. */
  readonly corpus: SourceCorpus = createSourceCorpus({
    engineApi: () => this.engineApi(),
    prefix: '[animus-extract]',
    strict: () => !!this.options.strict,
    warn: (message: string) => this.warn(message),
  });

  rawExtensionFallbacks = new Set<string>();

  /** The one mutator of a file's fallback state — every raw-serve exit of the
   *  transform hook reports here. Production keeps the set empty. */
  recordFallbackState(relativePath: string, isFallback: boolean): void {
    if (this.isProd) return;
    if (isFallback) this.rawExtensionFallbacks.add(relativePath);
    else this.rawExtensionFallbacks.delete(relativePath);
  }

  readonly hotUpdateEvents = new HotUpdateEvents();

  private pendingReloadTimer: ReturnType<typeof setTimeout> | null = null;

  packageMap: Record<string, string> = {};

  base = '/';

  // specifier → dev /@fs URL, or the `__VITE_ASSET__<referenceId>__` marker
  // Vite rewrites to the hashed file name before hashing the stylesheet.
  assetUrlBySpecifier = new Map<string, string>();

  assetResolutionFailures = new Set<string>();

  assetPassComplete = false;

  externalPackageDirs: string[] = [];

  externalDirOwners: Record<string, string> = {};

  externalFileOwners: Record<string, string> = {};

  externalSourceEntries = new Map<string, string>();

  externalPackageOutcomes: ExternalPackageOutcome[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  devServer: any;

  resolvedSystemPath: string | null = null;

  systemDependencyKeys: Set<string> = new Set();

  systemDependencyPaths: string[] = [];

  // Per-plugin-instance engine state: two differently-configured plugins in
  // one process must not share an engine.
  private v2Engine: V2ExtractEngine | null = null;
  private v2SentSources: Map<string, string> | null = null;
  private v2DriftWarned = false;

  /** Every native extraction call goes through this one accessor. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly engineApi: () => any;

  constructor(
    options: AnimusExtractOptions,
    // Test seam: `vi.mock` is a no-op in this repo's setup, so behavioral
    // tests inject a canned engine instead of loading the NAPI binary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engineApiOverride?: () => any
  ) {
    this.options = options;
    this.staticCssJson = serializeStaticCss(options.staticCss);
    this.verbose =
      options.verbose ||
      process.env.ANIMUS_DEBUG === '1' ||
      process.env.ANIMUS_DEBUG === 'true';
    this.extensionsSet = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
    this.excludeMatcher = createExcludeMatcher(options.exclude);

    if (engineApiOverride) {
      this.engineApi = engineApiOverride;
      return;
    }
    // The module id goes through a variable so bundlers leave the require
    // dynamic instead of resolving the native engine at build time.
    const engineModuleId = '@animus-ui/extract';
    this.engineApi = createV2EngineApi({
      label: 'animus-extract',
      isV2: () => true,
      loadNativeEngine: () => require(engineModuleId),
      rehydrateFilesJson: (filesJsonRaw) => {
        if (!filesJsonRaw.includes('"source":""')) return filesJsonRaw;
        const entries = parseFilesJson(filesJsonRaw, 'animus-extract');
        const analysisEntries = this.corpus.published.analysisEntries;
        for (const entry of entries) {
          if (entry.source === '') {
            entry.source = analysisEntries.get(entry.path)?.source ?? '';
          }
        }
        return JSON.stringify(entries);
      },
      store: {
        getEngine: () => this.v2Engine,
        setEngine: (engine) => {
          this.v2Engine = engine;
        },
        getSentSources: () => this.v2SentSources,
        setSentSources: (sources) => {
          this.v2SentSources = sources;
        },
        getDriftWarned: () => this.v2DriftWarned,
        setDriftWarned: (value) => {
          this.v2DriftWarned = value;
        },
      },
    });
  }

  log(msg: string): void {
    if (this.verbose) {
      (this.logger ?? console).info(`[animus] ${msg}`);
    }
  }

  /** Logs whether or not `verbose` is on — for events a developer must see
   *  without opting in. */
  info(msg: string): void {
    (this.logger ?? console).info(`[animus] ${msg}`);
  }

  warn(msg: string): void {
    (this.logger ?? console).warn(`[animus] ${msg}`);
  }

  logTimingWaterfall(timing: Record<string, number>): void {
    if (!this.verbose) return;
    for (const line of formatRustTimingWaterfall(timing, {
      indent: '         ',
      labelWidth: 15,
    })) {
      this.log(line);
    }
  }

  /** Load the system into `this.system`. On failure the previous config is
   *  kept; strict mode throws instead. */
  loadSystem(): void {
    this.resolvedSystemPath = resolve(this.rootDir, this.options.system);
    // The entry is always a member, even before any successful load or when
    // a failed non-strict reload keeps a stale dependency set.
    for (const key of toWatchKeys(this.resolvedSystemPath)) {
      this.systemDependencyKeys.add(key);
    }

    try {
      this.system = loadSystemConfig(this.engineApi, {
        systemPath: this.resolvedSystemPath,
        rootDir: this.rootDir,
        prefix: this.options.prefix,
      });
      const deps = this.system.dependencies ?? [];
      const keys = new Set<string>();
      for (const key of toWatchKeys(this.resolvedSystemPath)) keys.add(key);
      for (const dep of deps) {
        for (const key of toWatchKeys(dep)) keys.add(key);
      }
      this.systemDependencyKeys = keys;
      this.systemDependencyPaths = deps;
      this.registerSystemWatchPaths();
      this.systemVocabularyDiagnostics = vocabularyWitnessDiagnostics(
        this.system.vocabularyWitnessesJson
      );
    } catch (e) {
      if (this.options.strict) {
        throw new Error(
          `[animus-extract] Failed to load system from ${this.resolvedSystemPath}: ${e}`,
          { cause: e }
        );
      }
      console.warn(
        `[animus-extract] Failed to load system from ${this.resolvedSystemPath}:`,
        e
      );
    }
  }

  /** Runs project analysis and updates every manifest-derived state. Returns
   *  false when nothing published, and the caller must roll its cache back. */
  runAnalysis(
    fileEntries: Array<{ path: string; source: string; hash?: string }>
  ): boolean {
    let result: ProjectAnalysisResult;
    try {
      result = runProjectAnalysis(this.engineApi, {
        fileEntries,
        packageMap: this.packageMap,
        system: this.system,
        emitter: {
          runtimeImport: this.options.runtimeImport ?? '@animus-ui/system',
          cssModuleId: VIRTUAL_CSS_ID,
        },
        pathAliasesJson: this.pathAliasesJson,
        staticCssJson: this.staticCssJson,
        externalDirs: this.externalPackageDirs.map((dir) =>
          relative(this.rootDir, dir)
        ),
        devMode: !this.emissionProd,
        warn: (m) => this.warn(m),
        strict: this.options.strict,
        extraDiagnostics: this.systemVocabularyDiagnostics,
      });
    } catch (e) {
      if (this.options.strict) {
        throw new Error(`[animus-extract] analyzeProject failed: ${e}`, {
          cause: e,
        });
      }
      console.warn('[animus-extract] analyzeProject failed:', e);
      return false;
    }

    assertNoErrorDiagnostics(result.manifest.diagnostics);
    this.assertRuntimeImportSuppliesTerminals(result.manifest);

    this.storedManifest = result.manifest;
    this.storedManifestJson = result.manifestJson;

    this.storedSystemPropMapJson = JSON.stringify(
      result.manifest.system_prop_map
    );
    this.storedDynamicPropsJson = JSON.stringify(result.manifest.dynamic_props);

    this.reverseProvenance = result.manifest.reverse_provenance;

    this.storedSheets = result.manifest.sheets;

    this.globalCss = result.globalCss;
    this.resolvedComponentCss = result.componentCss;

    this.applyAssetSubstitutions();

    return true;
  }

  private assertRuntimeImportSuppliesTerminals(
    manifest: ProjectManifest
  ): void {
    const override = this.options.runtimeImport;
    if (!override || override === '@animus-ui/system') return;
    const offenders: string[] = [];
    for (const [id, descriptor] of Object.entries(manifest.components)) {
      if (
        /\bcreateComponent\(|\bcreateComposedFamily\(/.test(
          descriptor.replacement
        )
      ) {
        offenders.push(id);
      }
    }
    if (offenders.length === 0) return;
    const shown = offenders.slice(0, 5).join(', ');
    throw new Error(
      `[animus-extract] runtimeImport '${override}' is valid only when ` +
        `every extracted terminal is .asClass(), but ${offenders.length} ` +
        `component(s) need createComponent/createComposedFamily from the ` +
        `default '@animus-ui/system' runtime: ${shown}` +
        (offenders.length > 5 ? ', …' : '') +
        `. Remove the override or convert these terminals to .asClass().`
    );
  }

  /** The one ingest → quarantine → analyze → publish transaction. The corpus
   *  publishes only on success; `beforeAnalysis` runs after quarantine. */
  async analyzeIngested(options?: {
    rawEntries?: readonly RawSourceEntry[];
    beforeAnalysis?: (accepted: SourceIngestionResult) => void;
  }): Promise<{ ok: boolean; accepted: SourceIngestionResult }> {
    const accepted = await this.corpus.prepare(
      options?.rawEntries ?? {
        fileCache: this.fileCache,
        externalFileOwners: this.externalFileOwners,
      }
    );
    options?.beforeAnalysis?.(accepted);
    const ok = this.runAnalysis(accepted.analysisEntries) !== false;
    if (ok) this.publishSourceIngestion(accepted);
    return { ok, accepted };
  }

  publishSourceIngestion(result: SourceIngestionResult): void {
    this.corpus.publish(result);
    this.externalFileOwners = projectExternalFileOwners(
      result,
      this.externalFileOwners
    );

    this.enforceExternalTokenContracts();
  }

  devFsUrl(absPath: string): string {
    const base = this.base.endsWith('/') ? this.base.slice(0, -1) : this.base;
    return `${base}/@fs${absPath}`;
  }

  assetFallback(specifier: string, message: string, cause?: unknown): void {
    if (this.options.strict) {
      throw new Error(message, cause === undefined ? undefined : { cause });
    }
    this.warn(message);
    this.assetUrlBySpecifier.set(specifier, specifier);
    this.assetResolutionFailures.add(specifier);
  }

  /** Resolves asset specifiers a system reload introduced. Node-side only —
   *  the plugin hook context is unavailable here, so results can differ. */
  private applyAssetSubstitutions(): void {
    if (!this.isProd && this.assetPassComplete) {
      for (const specifier of findAssetSpecifiers(this.globalCss)) {
        if (this.assetResolutionFailures.delete(specifier)) {
          this.assetUrlBySpecifier.delete(specifier);
        }
        if (this.assetUrlBySpecifier.has(specifier)) continue;
        const resolved = resolveAssetFile(
          specifier,
          this.rootDir,
          this.pathAliasesJson
        );
        if (resolved) {
          this.assetUrlBySpecifier.set(specifier, this.devFsUrl(resolved));
        } else {
          this.assetFallback(
            specifier,
            `[animus-extract] unresolvable asset() specifier: ${specifier}`
          );
        }
      }
    }
    this.globalCss = substituteAssetPlaceholders(
      this.globalCss,
      this.assetUrlBySpecifier
    );
  }

  private resetCoalescer: ResetCoalescer | null = null;

  requestSystemReload(trigger: string): void {
    this.log(`HMR system reload scheduled: ${trigger}`);
    this.resetCoalescer ??= new ResetCoalescer(
      async () => this.performSystemReload(),
      /** The coalescer fires from a bare timer, outside Vite's error
       *  handling, so an unhandled strict throw would exit the process. */
      (err) => {
        const display = String(err);
        this.warn(`[animus-extract] system reload failed: ${display}`);
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? (err.stack ?? '') : '';
        this.devServer?.hot?.send({
          type: 'error',
          err: { message, stack, plugin: 'animus-extract' },
        });
      }
    );
    this.resetCoalescer.request();
  }

  async performSystemReload(): Promise<void> {
    return runExclusiveAnalysis(this, () =>
      this.performSystemReloadExclusive()
    );
  }

  private async performSystemReloadExclusive(): Promise<void> {
    const resetStart = performance.now();
    const prevPlans = snapshotFilePlans(this.storedManifest);
    try {
      this.loadSystem();

      // Strict ingestion diagnostics throw before the cache is cleared, so a
      // rejected reset leaves the last-good transform engine usable.
      const { ok } = await this.analyzeIngested({
        beforeAnalysis: () => clearEngineCache(this.engineApi),
      });
      if (!ok) return;
      // A type-only definition module has no import edge, so importer
      // propagation cannot deliver its new bytes — evict changed plans.
      invalidateFileModules(
        this,
        diffFilePlans(prevPlans, snapshotFilePlans(this.storedManifest))
      );
      this.log(
        `HMR system reload complete: ${Math.round(performance.now() - resetStart)}ms`
      );
    } finally {
      this.invalidateSystemReloadModules();
    }
  }

  private invalidateSystemReloadModules(): void {
    const server = this.devServer;
    if (!server) return;
    for (const moduleId of [
      RESOLVED_CSS_ID,
      RESOLVED_COMPONENTS_ID,
      RESOLVED_SYSTEM_PROPS_ID,
    ]) {
      const mod = server.moduleGraph.getModuleById(moduleId);
      if (mod) server.moduleGraph.invalidateModule(mod);
    }
    server.hot?.send({ type: 'full-reload' });
  }

  isSystemDependency(absFile: string): boolean {
    return toWatchKeys(absFile).some((key) =>
      this.systemDependencyKeys.has(key)
    );
  }

  /** Watch every loader-reported dependency path. Vite hard-ignores
   *  node_modules, so dependencies installed there produce no events. */
  registerSystemWatchPaths(): void {
    const watcher = this.devServer?.watcher;
    if (!watcher) return;
    if (this.systemDependencyPaths.length > 0) {
      watcher.add(this.systemDependencyPaths);
    }
    if (this.externalPackageDirs.length > 0) {
      watcher.add(this.externalPackageDirs);
    }
  }

  /** Invalidate the component CSS and system-props modules, then reload. The
   *  reload alone rescues nothing: Vite keeps serving its cached transform. */
  invalidateExtractedModules(): void {
    const server = this.devServer;
    if (!server) return;

    for (const moduleId of [RESOLVED_COMPONENTS_ID, RESOLVED_SYSTEM_PROPS_ID]) {
      const mod = server.moduleGraph.getModuleById(moduleId);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
      }
    }

    // Virtual-module HMR path matching is fragile for programmatic sends, so
    // a reload delivers the regenerated CSS; the timer coalesces a burst.
    if (this.pendingReloadTimer) return;
    this.pendingReloadTimer = setTimeout(() => {
      this.pendingReloadTimer = null;
      this.devServer?.hot?.send({ type: 'full-reload' });
    }, 100);
  }

  /** An unresolvable `.includes()` specifier or a stale dist entry under an
   *  extended package warns, and fails the build under `strict`. */
  enforceIncludeResolution(): void {
    for (const message of [
      unresolvableIncludesMessage(this.externalPackageOutcomes),
      staleDistIncludesMessage(this.externalPackageOutcomes),
    ]) {
      if (message === null) continue;
      if (this.options.strict) {
        throw new Error(message);
      }
      this.warn(message);
    }
  }

  enforceExternalTokenContracts(): void {
    enforceExternalTokenContracts({
      diagnostics: this.storedManifest?.diagnostics,
      fileOwners: this.externalFileOwners,
      dirOwners: this.externalDirOwners,
      sourceThemeManifestsJson: this.system.sourceThemeManifestsJson,
      strict: this.options.strict,
      prefix: '[animus-extract]',
      warn: (message: string) => this.warn(message),
    });
  }

  runSelfVerify(): void {
    const failures = runStructuralSelfCheck({
      componentCount: Object.keys(this.storedManifest?.components ?? {}).length,
      variableCss: this.system.variableCss,
      globalCss: this.globalCss,
      componentCss: this.resolvedComponentCss,
      layers: this.options.layers,
      externalOutcomes: this.externalPackageOutcomes,
    });

    for (const message of failures) {
      const line = `[animus:verify] ${message}`;
      if (this.options.strict) {
        throw new Error(line);
      }
      if (this.logger) {
        this.logger.warn(line, { timestamp: true });
      } else {
        console.warn(line);
      }
    }

    if (failures.length === 0) {
      this.log('[animus:verify] structural self-check passed');
    }
  }
}
