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
  createSourceIngestor,
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
  withoutInvalidOriginals,
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
  SourceEntryOwnership,
  SourceIngestionDiagnostic,
  SourceIngestionResult,
  SourceIngestor,
  SystemConfig,
  V2ExtractEngine,
} from '@animus-ui/extract/pipeline';
import type { Logger } from 'vite';

/** Pre-load / failed-load defaults — the plugin's historical initial state. */
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

/** Full raw originals for one adaptation attempt. */
export function buildRawEntriesFromCache(
  cache: ReadonlyMap<string, { hash: string; source: string }>
): Array<{ path: string; source: string; hash: string }> {
  return [...cache].map(([path, { hash, source }]) => ({
    path,
    source,
    hash,
  }));
}

// Serializes analysis transactions per context. Vite invokes transform
// hooks and hot updates concurrently, and every ingest→analyze→publish
// section spans await points — two interleaved transactions publish
// generations built from different cache snapshots (a later-created file
// vanishes from the earlier snapshot's publication, permanently: its
// detection guard never fires again). WeakMap-keyed by the owning plugin
// context; the stored chain never rejects, so a failed transaction cannot
// poison the lock.
const analysisChains = new WeakMap<PluginContext, Promise<void>>();

/** Run `task` after every previously scheduled analysis transaction for
 *  this context. Entry points only (transform detection, hot update,
 *  geological reset); helpers they call internally must stay unlocked. */
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

/** Generate the module from the four inputs the context currently holds. */
function generateSystemPropsModule(ctx: PluginContext): string {
  return buildSystemPropsModule({
    systemPropMapJson: ctx.storedSystemPropMapJson,
    groupRegistryJson: ctx.system.groupRegistryJson,
    dynamicProps: JSON.parse(ctx.storedDynamicPropsJson),
    transformsSource: ctx.storedTransformsSource,
  });
}

/**
 * The generated module for the current inputs, memoized against those exact
 * inputs. Reader-keyed on purpose: the four inputs are already strings, so the
 * key IS the inputs, and no writer owes the memo a refresh. A refresh
 * obligation spread across every writer is one thing to keep in sync per write
 * site, and the site that forgets serves a module from a generation that no
 * longer exists — permanently, since a store-on-generate memo never revisits
 * the decision.
 */
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

/**
 * The exact source `virtual:animus/system-props` serves for the current state.
 * One definition, so the served bytes and the HMR change decision can never be
 * computed from different inputs — and both read whatever the inputs say NOW,
 * whether they were published by an analysis or set by hand.
 */
export function systemPropsModuleSource(ctx: PluginContext): string {
  const key = systemPropsModuleKey(ctx);
  const memo = systemPropsModules.get(ctx);
  if (memo && memo.key === key) return memo.source;
  const source = generateSystemPropsModule(ctx);
  systemPropsModules.set(ctx, { key, source });
  return source;
}

/**
 * Drop a deleted (or renamed-away) raw original from the dev file cache.
 * Generated MDX/Svelte children live in `analysisEntryCache` and disappear
 * atomically when the next source-ingestion result publishes. External
 * package entries are rootDir-relative too (with leading `..` segments).
 */
export function pruneFileCache(
  cache: Map<string, { hash: string; source: string }>,
  rootDir: string,
  absPath: string
): boolean {
  const rel = relative(rootDir, resolve(absPath));
  return cache.delete(rel);
}

/**
 * Per-plugin-instance state and the pipeline operations over it. Hook
 * bodies live in their own modules (build-start, virtual-modules,
 * transform, hmr) and receive this context — the plugin factory in
 * index.ts only wires Vite hooks to those functions.
 *
 * A class rather than closure variables so each hook module names exactly
 * the state it touches, and the engine store (per-instance, never
 * module-level) is explicit.
 *
 * ── Relationship to `ExtractionSession` (the honest map) ──────────────────
 * This is the repo's SECOND session spine, and the split is deliberate but
 * only half a duplication. The Vite plugin never constructs an
 * `ExtractionSession` — zero references in this package; sessions are built
 * only by the unplugin host, the two Next arms, and the CLI. So these are
 * two spines for two DRIVERS, not one driver holding two.
 *
 * The contract distinction: `ExtractionSession` is an ARTIFACT-PUBLISHING
 * session (disk artifacts behind a commit transaction, module-level
 * singleton engine, cross-process readers); `PluginContext` is an IN-MEMORY
 * SERVE spine (virtual modules answered synchronously out of retained
 * state, per-instance engine, nothing published for another process).
 *
 * Of this class's ~50 fields, roughly 26 duplicate an `ExtractionSession`
 * authority field-for-field — `options`, `verbose`, `staticCssJson`,
 * `rootDir`, `system`, `lcssTargets`, `pathAliasesJson`, `extensionsSet`,
 * `excludeMatcher`, `systemVocabularyDiagnostics`, `fileCache`,
 * `analysisEntryCache`, `sourceOwnership`, `packageMap`, the asset-pass
 * trio, the five `external*` ownership maps, `externalPackageOutcomes`,
 * `resolvedSystemPath`, the two `systemDependency*` sets, and
 * `sourceIngestor` (whose twin the session's own comment already labels
 * "vite-plugin parity BY CODE"). The other ~24 are genuinely Vite-only:
 * `isProd`/`emissionProd`, `logger`, the `stored*` serve payloads,
 * `globalCss`/`resolvedComponentCss`/`storedSheets`, `layerDeclaration`,
 * `transformOutputHashes`, `reverseProvenance`, `analysisOwnerByPath`,
 * `rawExtensionFallbacks`, `hotUpdateEvents`, `pendingReloadTimer`, `base`,
 * `devServer`, the per-instance engine quartet, and `resetCoalescer`.
 *
 * RECORDED SMALLEST STEP (not implemented — do not implement it piecemeal):
 * extract a driver-neutral `SourceUniverse` read model into
 * `@animus-ui/extract` owning exactly the ingestion read model
 * (`sourceIngestor`, `analysisEntryCache`, `sourceOwnership`, and one
 * shared `publishSourceIngestion`), leaving `fileCache` ownership with each
 * driver — that divergence is real (this class mutates it incrementally
 * under `runExclusiveAnalysis`; the session rebinds it wholesale) and must
 * not be laundered away. Logged as C-018 in `docs/anti-slop-curiosities.md`.
 *
 * This class is also the uncaught case named by guardrail G1's own blind
 * spot ("does not catch a duplicated loop under a different class name",
 * `openspec/changes/standalone-extraction-cli/design.md`): G1 counts
 * `class ExtractionSession` definitions, so no gate sees this spine.
 */
export class PluginContext {
  readonly options: AnimusExtractOptions;
  readonly verbose: boolean;
  /** Serialized staticCss forced-emission declarations (stable key order). */
  readonly staticCssJson: string | null;

  isProd = false;
  /** Emission-mode signal (explicit `mode` option wins over the command);
   *  feeds engine devMode and the minify default. Lifecycle stays on
   *  `isProd`. */
  emissionProd = false;
  rootDir = '';
  logger: Logger | null = null;

  /** System-derived config (shared SystemConfig shape). */
  system: SystemConfig = emptySystemConfig();

  // Lightning CSS: resolved browser targets (computed once at configResolved)
  lcssTargets: LightningTargets = {};

  // Serialized path aliases from the host bundler's resolve.alias config.
  pathAliasesJson: string | null = null;

  // File extensions — refreshed at buildStart; HMR uses the same Set.
  extensionsSet: ReadonlySet<string>;

  // Exclusion matcher — constructed ONCE per options generation and shared
  // by buildStart discovery, HMR classification, and rediscovery (a fresh
  // matcher per changed file recompiled every glob and reset the hit
  // counters `stats()` exists to accumulate). Refreshed beside
  // `extensionsSet` at buildStart in case `options` was mutated between
  // server lifecycles.
  excludeMatcher: ExcludeMatcher;

  // Manifest state — populated at buildStart, consumed during transform/load.
  // The producing package's own wire declaration, not a plugin-private model:
  // this holds exactly the `ProjectAnalysisResult.manifest` published below,
  // so every reader (transform, HMR, rediscovery, self-verify) reads ONE
  // field spelling and one optionality answer. `null` is the pre-publication
  // state alone — a failed analysis leaves the previous manifest current.
  storedManifest: ProjectManifest | null = null;
  storedManifestJson = '';

  // Resolved CSS from .withGlobalStyles({ reset, global }) — @layer anm-global
  globalCss = '';
  // Pre-resolved component CSS with transforms + unit fallback applied
  resolvedComponentCss = '';
  storedSheets: ManifestSheets | null = null;

  // @layer declaration for HTML injection via transformIndexHtml.
  layerDeclaration = '';

  // Hash of the exact dev output each component-bearing module last served
  // (bridge import included), keyed by rootDir-relative path. The
  // presentation-only hot-update gate compares a post-edit re-transform
  // against this to decide whether a js-update would carry new bytes.
  // Entries for deleted files are inert (no event names them again; a
  // recreated path overwrites on its next transform).
  transformOutputHashes = new Map<string, string>();

  recordTransformOutput(relativePath: string, code: string): void {
    this.transformOutputHashes.set(relativePath, contentHash(code));
  }

  /** Vocabulary witness diagnostics from the sealed system's registration
   *  record (vocabulary-registration), awaiting the next analysis's shared
   *  surfacing pass. Surfacing stays with the single policy point inside
   *  runProjectAnalysis (next-plugin pins that there is exactly one
   *  surfacing call site). */
  systemVocabularyDiagnostics: ManifestDiagnostic[] = [];

  // Reverse provenance: parent_id → [child_ids] for transitive invalidation
  reverseProvenance: Record<string, string[]> = {};

  // System-props module inputs (served as virtual:animus/system-props)
  storedSystemPropMapJson = '{}';
  storedDynamicPropsJson = '{}';
  // Runtime transform functions for dynamic props are not supported —
  // transforms resolve at extraction time via boa_engine in Rust.
  storedTransformsSource = '{}';

  // Raw/original source cache for dev HMR (original path → raw hash/source).
  // Declared read-only so the compiler routes every write through
  // `mutateFileCache` — memos over this cache key on the generation counter
  // that mutator bumps, and a direct `.set` would move the cache underneath
  // them without moving the key.
  readonly fileCache: ReadonlyMap<string, { hash: string; source: string }> =
    new Map();

  /**
   * Mutations applied to `fileCache` so far. Consumers that memoize a verdict
   * derived from the whole cache (rediscovery's barren-walk memo) key on this
   * instead of on a property of the contents: `size` is the same after a
   * delete and an unrelated create, and a memo keyed on it skips the work a
   * changed cache demands. Counts mutation ATTEMPTS, so a no-op call costs a
   * redundant recompute rather than a stale answer.
   */
  fileCacheGeneration = 0;

  /**
   * THE one mutator of the raw-source cache: every add, replacement, and
   * deletion goes through here so no write can escape the counter above.
   */
  mutateFileCache<T>(
    mutate: (cache: Map<string, { hash: string; source: string }>) => T
  ): T {
    // SAFETY: `fileCache` is a Map declared as ReadonlyMap so that every
    // mutation has to pass through this method; this is the one place allowed
    // to write it, and the counter below is bumped for exactly that write.
    const cache = this.fileCache as Map<
      string,
      { hash: string; source: string }
    >;
    const result = mutate(cache);
    this.fileCacheGeneration += 1;
    return result;
  }

  // Last published parser-ready projection. Generated MDX/Svelte paths never
  // enter `fileCache`; they are replaced as one set with `sourceOwnership`.
  analysisEntryCache = new Map<string, { hash: string; source: string }>();
  sourceOwnership: Record<string, SourceEntryOwnership> = {};
  analysisOwnerByPath = new Map<string, string>();

  // rootDir-relative files whose LIVE SERVE is the raw source while the
  // analysis believes them extractable — an unresolved-parent drop named
  // the file, or the manifest listed components for it and the transform
  // still produced nothing (engine reported no components, or a non-strict
  // failure warned and passed the source through). Every such serve is a
  // runtime fallback: the file executes `.extend()` against whatever its
  // ancestor published. The compatibility publication barrier consults this
  // before serving an extracted extension ancestor — the fatal
  // raw-consumer/extracted-ancestor pair is withheld, never published
  // (openspec: dev-transform-coherence). Written ONLY through
  // `recordFallbackState`; entries clear on the file's next extracted serve.
  rawExtensionFallbacks = new Set<string>();

  /**
   * The one mutator of a file's own fallback state — every raw-serve exit
   * of the transform hook reports through here, so no exit can add without
   * a matching clear (or, worse, leave a stale record from an earlier
   * serve). Production has no barrier and no module graph to withhold from,
   * so the set stays empty there whatever the caller says.
   *
   * The barrier's one-shot withhold RELEASE is deliberately not this call:
   * it retires OTHER files' records after invalidating them, which is not a
   * statement about their current serve.
   */
  recordFallbackState(relativePath: string, isFallback: boolean): void {
    if (this.isProd) return;
    if (isFallback) this.rawExtensionFallbacks.add(relativePath);
    else this.rawExtensionFallbacks.delete(relativePath);
  }

  // Once-per-file-event coordination across the per-environment `hotUpdate`
  // dispatches (see hmr.ts) — the analysis half runs for one of them.
  readonly hotUpdateEvents = new HotUpdateEvents();

  // Pending recovery-reload timer — N out-of-band invalidations inside one
  // burst coalesce into ONE reload (the delay is coalescing, not a
  // synchronization guarantee). See invalidateExtractedModules.
  private pendingReloadTimer: ReturnType<typeof setTimeout> | null = null;

  // Package resolution map built at buildStart (reused during HMR)
  packageMap: Record<string, string> = {};

  // Public base path from the resolved Vite config (dev /@fs asset URLs)
  base = '/';

  // asset() placeholder substitutions resolved at buildStart. Dev entries
  // map specifier → base-prefixed /@fs URL; build entries map specifier →
  // Vite `__VITE_ASSET__<referenceId>__` marker, which Vite's CSS/asset
  // pipeline resolves to the hashed file name before the stylesheet asset
  // is itself hashed and emitted.
  assetUrlBySpecifier = new Map<string, string>();

  // Non-strict failures are substituted literally for the current pass but
  // are not successes: a later system epoch must retry them.
  assetResolutionFailures = new Set<string>();

  // Set once buildStart's bundler-resolved asset pass has run; gates the
  // dev-only late-specifier resolution in runAnalysis (before the pass,
  // buildStart owns resolution and the map is deliberately empty).
  assetPassComplete = false;

  // Absolute directory prefixes for external DS packages
  externalPackageDirs: string[] = [];

  // Absolute package dir → owning specifier (cross-source correlation)
  externalDirOwners: Record<string, string> = {};

  // rootDir-relative external file → owning specifier (correlation join)
  externalFileOwners: Record<string, string> = {};

  // External package specifier → absolute source entry (resolveId redirect)
  externalSourceEntries = new Map<string, string>();

  // Per-specifier discovery outcomes from buildStart (self-verify input)
  externalPackageOutcomes: ExternalPackageOutcome[] = [];

  // Dev server reference for programmatic module invalidation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  devServer: any;

  // Resolved system module path for geological reset detection
  resolvedSystemPath: string | null = null;

  // Membership keys (lexical + canonical, via toWatchKeys) for every module
  // the loader evaluated for the current system — the geological-reset set.
  // A failed non-strict reload keeps the last successful set (plus the
  // entry), matching the stale config still being served.
  systemDependencyKeys: Set<string> = new Set();

  // The loader-reported dependency paths as-is, for watcher registration.
  systemDependencyPaths: string[] = [];

  // Per-PLUGIN-INSTANCE v2 engine state (no module-level engine —
  // two differently-configured plugins in one process must not share state).
  private v2Engine: V2ExtractEngine | null = null;
  private v2SentSources: Map<string, string> | null = null;
  private v2DriftWarned = false;

  /** Single engine choke-point for every native extraction call. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly engineApi: () => any;

  constructor(
    options: AnimusExtractOptions,
    // Injected-fn test seam (vi.mock is a no-op in this repo's setup): lets
    // behavioral tests feed a canned engine without loading the NAPI binary.
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
    // Adapt the function API onto the stateful v2 handle via the single
    // authoritative factory in @animus-ui/extract/pipeline (shared with
    // next-plugin). The package root IS the v2 engine since retire-extract-v1.
    // Indirect module id keeps the require dynamic under bundling.
    const engineModuleId = '@animus-ui/extract';
    this.engineApi = createV2EngineApi({
      label: 'animus-extract',
      isV2: () => true,
      loadNativeEngine: () => require(engineModuleId),
      // Defensive rehydration: every current caller sends full raw sources
      // (buildRawEntriesFromCache), but the adapter contract still admits
      // cache-aware callers sending EMPTY sources for unchanged files, and
      // v2 has NO Rust-side cache (arch-extract-v2-spine) — refill from the
      // analysis-entry cache before analyze.
      rehydrateFilesJson: (filesJsonRaw) => {
        if (!filesJsonRaw.includes('"source":""')) return filesJsonRaw;
        const entries = parseFilesJson(filesJsonRaw, 'animus-extract');
        for (const entry of entries) {
          if (entry.source === '') {
            entry.source =
              this.analysisEntryCache.get(entry.path)?.source ?? '';
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

  /**
   * Standard-level information — emitted whether or not `verbose` is on.
   * Reserved for events a developer must see without opting in, e.g. a file
   * created after buildStart being folded into the analysis (openspec:
   * hmr-new-file-detection, "New file detection logging").
   */
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

  /**
   * Load a SystemInstance via Rust NAPI (rquickjs bundled eval) into
   * `this.system`. On failure the previous config is kept (strict mode
   * throws instead).
   */
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
      // The sealed record is the witness channel (the loader's evaluation
      // host shims console): map its coded entries for the next analysis's
      // shared surfacing pass. A failed reload keeps the previous system
      // AND its matching witnesses.
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

  /**
   * Run project analysis via the shared `runProjectAnalysis` and update
   * all manifest-derived state. Returns whether the analysis PUBLISHED —
   * `false` means the previous manifest is still current, and callers that
   * advanced the file cache for this attempt must roll that entry back or
   * the content-hash gate will suppress the same-content retry forever
   * (openspec: dev-transform-coherence, "Failed analyses do not suppress
   * equal-content retries"). Strict mode still throws.
   */
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

    // Error-diagnostic escalation (extraction-diagnostics §Error diagnostics
    // fail the build, design D8): `kind: "error"` entries throw in EVERY mode
    // — deliberately outside the non-strict catch above, and BEFORE any
    // manifest-derived state is published, so no stylesheet from this
    // analysis is served (build fails; dev surfaces Vite's plugin-error
    // overlay via the callers' normal throw paths).
    assertNoErrorDiagnostics(result.manifest.diagnostics);
    this.assertRuntimeImportSuppliesTerminals(result.manifest);

    this.storedManifest = result.manifest;
    this.storedManifestJson = result.manifestJson;

    this.storedSystemPropMapJson = JSON.stringify(
      result.manifest.system_prop_map
    );
    this.storedDynamicPropsJson = JSON.stringify(result.manifest.dynamic_props);

    // Update reverse provenance for transitive invalidation
    this.reverseProvenance = result.manifest.reverse_provenance;

    // Store structured sheets for dev split delivery
    this.storedSheets = result.manifest.sheets;

    this.globalCss = result.globalCss;
    this.resolvedComponentCss = result.componentCss;

    // A system edit can INTRODUCE an asset() specifier after buildStart —
    // substitution alone only knows buildStart's map, so a new placeholder
    // would otherwise survive verbatim (and bypass strict).
    this.applyAssetSubstitutions();

    return true;
  }

  /**
   * `runtimeImport` swaps ONE module specifier under every generated
   * factory import, and the engine performs no export validation — an
   * override that supplies only `createClassResolver` (the documented
   * class-resolver entry contract) breaks the bundle at LOAD the moment any
   * non-`.asClass()` terminal exists, with the error pointing at generated
   * code. Guaranteed-broken output escalates in every mode, exactly like
   * error diagnostics (extraction-diagnostics §Error diagnostics fail the
   * build), naming the offending components instead of the import site.
   */
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

  /** The shared ingestion policy point — capability guard, facts memo, and
   *  warn-dedupe lifecycle all live in the pipeline, not per host. */
  private sourceIngestor: SourceIngestor = createSourceIngestor({
    engineApi: () => this.engineApi(),
    prefix: '[animus-extract]',
    strict: () => !!this.options.strict,
    warn: (message: string) => this.warn(message),
  });

  /** Prepare one raw-source corpus through the shared adaptation boundary. */
  async ingestRawSources(
    fileEntries: readonly RawSourceEntry[]
  ): Promise<SourceIngestionResult> {
    return this.sourceIngestor.ingest(fileEntries);
  }

  /** Surface adapter diagnostics under the shared strict/warn policy. */
  surfaceSourceDiagnostics(
    diagnostics: readonly SourceIngestionDiagnostic[]
  ): Set<string> {
    return this.sourceIngestor.surfaceDiagnostics(diagnostics);
  }

  /**
   * The one ingest → quarantine → analyze → publish transaction, shared by
   * buildStart and every incremental path. Per-file quarantine: one invalid
   * original warns and drops without aborting the rest of the corpus
   * (strict mode throws from the shared policy). `runAnalysis(...) !==
   * false` is the documented success contract (a `void` behavioral test
   * double reads as success), and the accepted corpus publishes only on
   * success. `beforeAnalysis` runs between quarantine and analysis for the
   * two sites with a documented ordering constraint: buildStart's dev-cache
   * seed must survive a strict analysis throw, and the geological reset
   * clears the engine cache only after strict ingestion diagnostics had
   * their chance to throw.
   */
  async analyzeIngested(options?: {
    rawEntries?: readonly RawSourceEntry[];
    beforeAnalysis?: (accepted: SourceIngestionResult) => void;
  }): Promise<{ ok: boolean; accepted: SourceIngestionResult }> {
    const ingested = await this.ingestRawSources(
      options?.rawEntries ?? buildRawEntriesFromCache(this.fileCache)
    );
    const accepted = withoutInvalidOriginals(
      ingested,
      this.surfaceSourceDiagnostics(ingested.diagnostics)
    );
    options?.beforeAnalysis?.(accepted);
    const ok = this.runAnalysis(accepted.analysisEntries) !== false;
    if (ok) this.publishSourceIngestion(accepted);
    return { ok, accepted };
  }

  /** Publish every parser child and ownership edge atomically after analysis. */
  publishSourceIngestion(result: SourceIngestionResult): void {
    this.sourceIngestor.markPublished(result);
    this.analysisEntryCache = new Map(
      result.analysisEntries.map((entry) => [
        entry.path,
        { hash: entry.hash, source: entry.source },
      ])
    );
    this.sourceOwnership = result.ownership;
    this.analysisOwnerByPath = new Map();
    for (const owner of Object.values(result.ownership)) {
      for (const analysisPath of owner.analysisPaths) {
        this.analysisOwnerByPath.set(analysisPath, owner.originalPath);
      }
    }
    // The owner projection is the shared one (the session runs it at the same
    // point in its own transaction), so a generated child correlates to the
    // same package in both hosts — the token-contract diagnostic joins through
    // this map and must not depend on which driver is running.
    this.externalFileOwners = projectExternalFileOwners(
      result,
      this.externalFileOwners
    );

    // Cross-source token contracts run on EVERY publication — buildStart,
    // HMR re-analysis, new-file detection, and the geological reset alike.
    // AFTER the ownership maps above, deliberately: the join correlates
    // diagnostics raised against generated MDX/Svelte children through
    // `externalFileOwners`, and those child keys enter the map in this very
    // method — enforcing inside runAnalysis dropped a violation on the
    // exact pass that introduced it (next-plugin orders these the same
    // way: owners project before analyzeAndEmit).
    this.enforceExternalTokenContracts();
  }

  /** Base-prefixed dev URL for an absolute file (Vite mounts /@fs under base). */
  devFsUrl(absPath: string): string {
    const base = this.base.endsWith('/') ? this.base.slice(0, -1) : this.base;
    return `${base}/@fs${absPath}`;
  }

  /**
   * The shared unresolvable-asset policy: fail the build under `strict`,
   * else warn and record the identity mapping so the specifier emits
   * literally.
   */
  assetFallback(specifier: string, message: string, cause?: unknown): void {
    if (this.options.strict) {
      throw new Error(message, cause === undefined ? undefined : { cause });
    }
    this.warn(message);
    this.assetUrlBySpecifier.set(specifier, specifier);
    this.assetResolutionFailures.add(specifier);
  }

  /**
   * The one asset-substitution pass per analysis. In dev, a specifier not
   * already mapped by buildStart's bundler-resolved pass (a geological
   * reset regenerates globalCss from an edited system, which may reference
   * NEW assets) is resolved Node-side first — host aliases, then Node,
   * then package root; bundler-only resolutions can differ, since the
   * plugin hook context is unavailable on this path. Strict semantics
   * match buildStart.
   */
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

  // Burst-coalescing scheduler for geological resets (lazy; per instance).
  private resetCoalescer: ResetCoalescer | null = null;

  /**
   * Schedule a geological reset through the burst coalescer. N dependency
   * events within the quiescence window produce one reset; events during a
   * running reset produce exactly one follow-up.
   */
  requestGeologicalReset(trigger: string): void {
    this.log(`HMR geological reset scheduled: ${trigger}`);
    this.resetCoalescer ??= new ResetCoalescer(
      async () => this.performGeologicalReset(),
      /**
       * A failed reset must surface without killing the server: the coalescer
       * fires from a bare timer, OUTSIDE Vite's handleHMRUpdate catch, so a
       * strict-mode throw (asset resolution, token contracts, system load)
       * would otherwise be an unhandled exception that exits the process.
       * Strict-in-dev means the error overlay, matching the transform/HMR
       * strict paths that Vite itself catches.
       */
      (err) => {
        const display = String(err);
        this.warn(`[animus-extract] geological reset failed: ${display}`);
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

  /**
   * The geological reset: reload the system (refreshing the dependency
   * set), clear the Rust per-file cache, re-analyze everything with full
   * sources, then invalidate the static/component/system-prop virtual
   * modules and reload the client.
   */
  async performGeologicalReset(): Promise<void> {
    // Exclusive: the coalescer fires from a bare timer, so a reset can
    // otherwise interleave with an in-flight transform detection or hot
    // update transaction over the same fileCache.
    return runExclusiveAnalysis(this, () =>
      this.performGeologicalResetExclusive()
    );
  }

  private async performGeologicalResetExclusive(): Promise<void> {
    const resetStart = performance.now();
    // Snapshot BEFORE the reload: replacement-plan content is the shared
    // transform-byte authority, so the pre/post diff below is exactly the
    // set of source files whose served bytes change with the new system.
    const prevPlans = snapshotFilePlans(this.storedManifest);
    try {
      this.loadSystem();

      // Strict ingestion diagnostics throw before the engine cache is
      // cleared (the hook runs after quarantine), so the last-good
      // transform engine stays usable on a rejected reset.
      const { ok } = await this.analyzeIngested({
        beforeAnalysis: () => clearEngineCache(this.engineApi),
      });
      if (!ok) return;
      // A type-only (or otherwise unreachable) definition module has no
      // browser import edge, so importer propagation cannot deliver its new
      // replacement bytes — evict every module node whose plan changed, in
      // every environment graph, before the finally-block full reload
      // re-fetches. Equal-plan files stay cached; failed resets return
      // above and evict nothing (openspec: vite-extraction-plugin,
      // "Geological reset invalidates changed source replacement plans").
      invalidateFileModules(
        this,
        diffFilePlans(prevPlans, snapshotFilePlans(this.storedManifest))
      );
      this.log(
        `HMR geological reset complete: ${Math.round(performance.now() - resetStart)}ms`
      );
    } finally {
      // A failed reset still re-delivers the last good publication. Besides
      // preserving the historical dev-server recovery contract, this makes
      // the attempted reset observable without publishing a partial source
      // generation.
      this.invalidateGeologicalResetModules();
    }
  }

  private invalidateGeologicalResetModules(): void {
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

  /**
   * True when the file is a member of the system's evaluated module-file
   * set. Tested BEFORE component-scan exclude filters: a system dependency
   * edit invalidates the compiler registry regardless of what the user
   * excluded from component scanning.
   */
  isSystemDependency(absFile: string): boolean {
    return toWatchKeys(absFile).some((key) =>
      this.systemDependencyKeys.has(key)
    );
  }

  /**
   * Ask the dev watcher to watch every loader-reported dependency path.
   * Covers system modules unreachable from app imports (workspace package
   * config files). Vite's watcher hard-ignores `node_modules`, so
   * node_modules-installed system dependencies produce no events — a
   * documented limitation; workspace deps resolve to real paths outside
   * node_modules and are watchable. No-ops without a dev server.
   */
  registerSystemWatchPaths(): void {
    const watcher = this.devServer?.watcher;
    if (!watcher) return;
    if (this.systemDependencyPaths.length > 0) {
      watcher.add(this.systemDependencyPaths);
    }
    // External DS package sources live outside the root walk; without an
    // explicit watch their edits and deletions never reach `hotUpdate`, so
    // the deletion-pruning path is never driven and the last-extracted CSS
    // survives. node_modules-installed packages remain unwatchable
    // (Vite hard-ignores them) — the same documented limitation as system
    // dependencies above; workspace-resolved dirs are real paths and watch.
    if (this.externalPackageDirs.length > 0) {
      watcher.add(this.externalPackageDirs);
    }
  }

  /**
   * Invalidate the component CSS and system-props virtual modules, then
   * reload the client. Shared by the two out-of-band re-analysis paths — a
   * file created after buildStart (transform) and a file deleted during dev
   * (the `hotUpdate` delete event) — which both mutate the cache, re-run
   * analysis, and then need the client to pick up the regenerated CSS.
   * No-ops outside dev.
   *
   * `devServer.moduleGraph` is Vite's back-compat mixed graph: its
   * `getModuleById` searches the client AND ssr environment graphs and its
   * `invalidateModule` invalidates both instances behind the returned node,
   * which is exactly the reach this path wants. It stays the seam here.
   *
   * Both modules are invalidated unconditionally, and deliberately so: the
   * appearance or disappearance of a whole component file is not the
   * steady-state edit the change-gated path governs, and a client reload does
   * NOT rescue a module that was never invalidated — Vite keeps serving its
   * cached transform result across reloads (openspec: hmr-new-file-detection,
   * "CSS invalidation after new file analysis").
   */
  invalidateExtractedModules(): void {
    const server = this.devServer;
    if (!server) return;

    for (const moduleId of [RESOLVED_COMPONENTS_ID, RESOLVED_SYSTEM_PROPS_ID]) {
      const mod = server.moduleGraph.getModuleById(moduleId);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
      }
    }

    // These paths are rare (creating or deleting a component during dev).
    // Reload is the most reliable way to deliver the regenerated CSS —
    // virtual module HMR path matching is fragile for programmatic sends.
    // Guarded: the server may have been torn down inside the delay.
    if (this.pendingReloadTimer) return;
    this.pendingReloadTimer = setTimeout(() => {
      this.pendingReloadTimer = null;
      this.devServer?.hot?.send({ type: 'full-reload' });
    }, 100);
  }

  /**
   * The buildStart gate over include resolution
   * (external-package-file-discovery: silence is never an outcome). An
   * unresolvable `.includes()` specifier warns in non-strict mode and FAILS
   * the build under `strict: true`, naming every offending specifier —
   * a typo'd include must not ship a build missing its component CSS. A
   * stale dist entry under an extended package (first-class-extension D13)
   * rides the same seam: a merge against it would silently skew registry
   * content the discovered sources no longer match.
   */
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

  /**
   * The post-analysis gate over cross-source token contracts
   * (extraction-diagnostics): a discovered component referencing a token its
   * OWN package defines but the consumer theme does not gets the teaching
   * error naming the token, component, source package, and the missing
   * `createTheme().extend(...)`. Wiring and severity routing live in the
   * shared pipeline gate (next-plugin parity by construction).
   */
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
    // Checks live in the shared pipeline (one implementation for every
    // driver — openspec: standalone-extraction-cli); this method owns only
    // the Vite-side failure POLICY (strict throw vs logger warn).
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
