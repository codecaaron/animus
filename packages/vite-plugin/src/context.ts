import {
  assembleStylesheet,
  buildSystemPropsModule,
  contentHash,
  createV2EngineApi,
  DEFAULT_EXTENSIONS,
  clearEngineCache,
  enforceExternalTokenContracts,
  findAssetSpecifiers,
  formatRustTimingWaterfall,
  loadSystemConfig,
  mergeExternalKeyframes,
  resolveAssetFile,
  runProjectAnalysis,
  serializeStaticCss,
  staleDistIncludesMessage,
  substituteAssetPlaceholders,
  toWatchKeys,
  unresolvableIncludesMessage,
} from '@animus-ui/extract/pipeline';
import { relative, resolve } from 'path';

import {
  RESOLVED_COMPONENTS_ID,
  RESOLVED_CSS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
  VIRTUAL_CSS_ID,
} from './constants';
import { HotUpdateEvents } from './hot-update-events';
import { ResetCoalescer } from './reset-coalescer';

import type { LightningTargets } from './css';
import type { AnimusExtractOptions } from './index';
import type {
  ExternalPackageOutcome,
  ManifestDiagnostic,
  SystemConfig,
  V2ExtractEngine,
} from '@animus-ui/extract/pipeline';
import type { Logger } from 'vite';

/**
 * Structured per-layer CSS sheets from the Rust crate (dev split delivery).
 * Mirrors the `CssSheets` struct in packages/extract/src/css_generator.rs —
 * keep these fields in sync.
 */
export interface CssSheets {
  declaration: string;
  global: string;
  base: string;
  variants: string;
  compounds: string;
  states: string;
  system: string;
  custom: string;
}

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

/**
 * Reconstruct file entries from cache, including content hashes.
 * For unchanged files (hash matches changedPath), sends empty source
 * to avoid serializing full source text across the NAPI boundary.
 * The engine adapter's `rehydrateFilesJson` refills empty sources from
 * this same cache before analyze.
 */
export function buildFileEntriesFromCache(
  cache: Map<string, { hash: string; source: string }>,
  changedPath?: string
): Array<{ path: string; source: string; hash: string }> {
  const entries: Array<{ path: string; source: string; hash: string }> = [];
  for (const [path, { hash, source }] of cache) {
    entries.push({
      path,
      source: path === changedPath ? source : '',
      hash,
    });
  }
  return entries;
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
 * The exact source `virtual:animus/system-props` serves for the current state.
 * One definition, so the served bytes and the change decision below can never
 * be computed from different inputs.
 *
 * A real context carries the module already generated (`systemPropsModuleMemo`,
 * refreshed wherever the four inputs move), so serving it and deciding whether
 * it changed are both reads. Contexts that publish those inputs by hand — the
 * behavioral test doubles — carry no memo and generate here instead.
 */
export function systemPropsModuleSource(ctx: PluginContext): string {
  // Store-on-generate: after this call the serving path and the change
  // decision always read the SAME memoized bytes, so they cannot diverge
  // even on a context (test doubles) that published the inputs by hand.
  return (ctx.systemPropsModuleMemo ??= generateSystemPropsModule(ctx));
}

/**
 * Run project analysis and report whether the served system-props module
 * CHANGED.
 *
 * The module is imported by every module that renders a system prop, so
 * re-delivering it pushes an update through all of them; every analysis
 * republishes its inputs whether or not they moved, so a new analysis is not
 * itself an admissible trigger (openspec: vite-extraction-plugin, "System prop
 * map HMR invalidation").
 *
 * The comparison is over the GENERATED MODULE, not over the prop map alone.
 * The map is one of four inputs, and they move independently: widening a
 * component's `.system({ ... })` opt-in adds a `dynamicPropConfig` entry while
 * minting no new utility class, so a map-only comparison reports "unchanged"
 * and the client is left with a config missing the new prop — permanently,
 * since Vite keeps serving the module's cached transform result across full
 * page reloads. Comparing the artifact itself needs no argument about which
 * inputs are volatile this month.
 *
 * A free function rather than a method: the comparison must run for real
 * against any context the caller holds, including the behavioral test doubles
 * that stand in for the engine.
 */
export function runAnalysisTrackingSystemProps(
  ctx: PluginContext,
  fileEntries: Array<{ path: string; source: string; hash?: string }>
): boolean {
  const before = systemPropsModuleSource(ctx);
  ctx.runAnalysis(fileEntries);
  return systemPropsModuleSource(ctx) !== before;
}

/**
 * Drop a deleted (or renamed-away) file from the dev file cache so its
 * last-known source stops riding along as a ghost entry on every later
 * re-analysis. Both key forms are tried: the plain rootDir-relative path, and
 * the `.tsx` suffix MDX sources carry after preprocessing. External package
 * entries are rootDir-relative too (with leading `..` segments) and prune the
 * same way. Returns whether an entry was actually removed.
 */
export function pruneFileCache(
  cache: Map<string, { hash: string; source: string }>,
  rootDir: string,
  absPath: string
): boolean {
  const rel = relative(rootDir, resolve(absPath));
  return cache.delete(rel) || cache.delete(rel + '.tsx');
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
 */
export class PluginContext {
  readonly options: AnimusExtractOptions;
  readonly verbose: boolean;
  /** Serialized staticCss forced-emission declarations (stable key order). */
  readonly staticCssJson: string | null;

  isProd = false;
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

  // Manifest state — populated at buildStart, consumed during transform/load
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storedManifest: any = null;
  storedManifestJson = '';

  // Resolved CSS from .withGlobalStyles({ reset, global }) — @layer anm-global
  globalCss = '';
  // Pre-resolved component CSS with transforms + unit fallback applied
  resolvedComponentCss = '';
  storedSheets: CssSheets | null = null;

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

  /**
   * Merge `Keyframes` collections from discovered external package entries
   * into the system's collections (keyframes-only carve-out — the consumer
   * system stays the singular config authority). Runs after buildStart
   * discovery AND after every geological-reset system reload, since a reload
   * rebuilds `this.system` from the consumer entry alone.
   */
  applyExternalKeyframes(): void {
    if (this.externalSourceEntries.size === 0) return;
    const merge = mergeExternalKeyframes(
      (entry, root) => this.engineApi().scanKeyframesExports(entry, root),
      this.system.keyframesJson,
      this.externalSourceEntries.values(),
      this.rootDir
    );
    this.system.keyframesJson = merge.keyframesJson;
    // Surfacing stays with the single shared policy point inside
    // runProjectAnalysis (next-plugin pins that there is exactly one
    // surfacing call site) — stash for the next analysis to carry.
    this.externalKeyframesDiagnostics = merge.diagnostics;
  }

  /** Discovery-time keyframes diagnostics awaiting the next analysis's
   *  shared surfacing pass. */
  externalKeyframesDiagnostics: ManifestDiagnostic[] = [];

  // Reverse provenance: parent_id → [child_ids] for transitive invalidation
  reverseProvenance: Record<string, string[]> = {};

  // System-props module inputs (served as virtual:animus/system-props)
  storedSystemPropMapJson = '{}';
  storedDynamicPropsJson = '{}';
  // Runtime transform functions for dynamic props are not supported —
  // transforms resolve at extraction time via boa_engine in Rust.
  storedTransformsSource = '{}';

  // The generated module for the four inputs above, refreshed by the only two
  // writers of those inputs (loadSystem, runAnalysis). Read through
  // `systemPropsModuleSource`; `null` means no writer has run yet.
  systemPropsModuleMemo: string | null = null;

  // Content-hash file cache for dev HMR (path → { hash, source })
  fileCache = new Map<string, { hash: string; source: string }>();

  // Once-per-file-event coordination across the per-environment `hotUpdate`
  // dispatches (see hmr.ts) — the analysis half runs for one of them.
  readonly hotUpdateEvents = new HotUpdateEvents();

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
      // A cache-aware caller (buildFileEntriesFromCache) may send EMPTY
      // sources for unchanged files. v2 has NO Rust-side cache
      // (arch-extract-v2-spine), so re-hydrate empty sources from the file
      // cache before analyze.
      rehydrateFilesJson: (filesJsonRaw) => {
        if (!filesJsonRaw.includes('"source":""')) return filesJsonRaw;
        const entries = JSON.parse(filesJsonRaw) as Array<{
          path: string;
          source: string;
          hash?: string;
        }>;
        for (const entry of entries) {
          if (entry.source === '') {
            entry.source = this.fileCache.get(entry.path)?.source ?? '';
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
      // A reload rebuilds `this.system` from the consumer entry alone —
      // re-apply the external keyframes carve-out (no-op before discovery).
      this.applyExternalKeyframes();
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
    // `groupRegistryJson` is one of the served module's four inputs, and a
    // failed non-strict reload keeps the previous one — either way the memo
    // has to match what `this.system` now holds.
    this.systemPropsModuleMemo = generateSystemPropsModule(this);
  }

  /**
   * Run project analysis via the shared `runProjectAnalysis` and update
   * all manifest-derived state.
   */
  runAnalysis(
    fileEntries: Array<{ path: string; source: string; hash?: string }>
  ): void {
    try {
      const result = runProjectAnalysis(this.engineApi, {
        fileEntries,
        packageMap: this.packageMap,
        system: this.system,
        emitter: {
          runtimeImport: '@animus-ui/system',
          cssModuleId: VIRTUAL_CSS_ID,
        },
        pathAliasesJson: this.pathAliasesJson,
        staticCssJson: this.staticCssJson,
        externalDirs: this.externalPackageDirs.map((dir) =>
          relative(this.rootDir, dir)
        ),
        devMode: !this.isProd,
        warn: (m) => this.warn(m),
        strict: this.options.strict,
        extraDiagnostics: this.externalKeyframesDiagnostics,
      });

      this.storedManifest = result.manifest;
      this.storedManifestJson = result.manifestJson;

      this.storedSystemPropMapJson = JSON.stringify(
        result.manifest?.system_prop_map ?? {}
      );
      this.storedDynamicPropsJson = JSON.stringify(
        result.manifest?.dynamic_props ?? {}
      );

      // Update reverse provenance for transitive invalidation
      this.reverseProvenance = result.manifest?.reverse_provenance ?? {};

      // Store structured sheets for dev split delivery
      this.storedSheets = result.manifest?.sheets ?? null;

      this.globalCss = result.globalCss;
      this.resolvedComponentCss = result.componentCss;
    } catch (e) {
      if (this.options.strict) {
        throw new Error(`[animus-extract] analyzeProject failed: ${e}`, {
          cause: e,
        });
      }
      console.warn('[animus-extract] analyzeProject failed:', e);
      return;
    }

    // The system-props inputs were just republished, so regenerate the served
    // module once, here. Both readers — the `load` hook and the HMR change
    // decision — then compare and serve the same bytes without rebuilding.
    this.systemPropsModuleMemo = generateSystemPropsModule(this);

    // A system edit can INTRODUCE an asset() specifier after buildStart —
    // substitution alone only knows buildStart's map, so a new placeholder
    // would otherwise survive verbatim (and bypass strict).
    this.applyAssetSubstitutions();

    // Cross-source token contracts run on EVERY analysis pass — buildStart,
    // HMR re-analysis, new-file detection, and the geological reset alike —
    // so a dev edit that references an uninherited kit token surfaces
    // immediately (next-plugin parity: both hosts share one gate).
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
      () => this.performGeologicalReset(),
      (err) => this.geologicalResetFailed(err)
    );
    this.resetCoalescer.request();
  }

  /**
   * A failed reset must surface without killing the server: the coalescer
   * fires from a bare timer, OUTSIDE Vite's handleHMRUpdate catch, so a
   * strict-mode throw (asset resolution, token contracts, system load)
   * would otherwise be an unhandled exception that exits the process.
   * Strict-in-dev means the error overlay, matching the transform/HMR
   * strict paths that Vite itself catches.
   */
  private geologicalResetFailed(err: unknown): void {
    this.warn(`[animus-extract] geological reset failed: ${err}`);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    this.devServer?.hot?.send({
      type: 'error',
      err: { message, stack, plugin: 'animus-extract' },
    });
  }

  /**
   * The geological reset: reload the system (refreshing the dependency
   * set), clear the Rust per-file cache, re-analyze everything with full
   * sources, then invalidate the static/component/system-prop virtual
   * modules and reload the client.
   */
  performGeologicalReset(): void {
    const resetStart = performance.now();
    this.loadSystem();
    clearEngineCache(this.engineApi);

    // Full sources — the Rust cache was just cleared, so every file is a
    // cache miss that needs real text for OXC parsing.
    const fileEntries: Array<{ path: string; source: string; hash: string }> =
      [];
    for (const [path, { hash, source }] of this.fileCache) {
      fileEntries.push({ path, source, hash });
    }
    this.runAnalysis(fileEntries);
    this.log(
      `HMR geological reset complete: ${Math.round(performance.now() - resetStart)}ms`
    );

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
    setTimeout(() => {
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
    const failures: string[] = [];

    if (Object.keys(this.storedManifest?.components ?? {}).length === 0) {
      failures.push(
        'No component CSS produced — check the system file and its includes list'
      );
    }

    // A declared include that resolved but yielded nothing is a silent
    // misconfiguration (empty src/, everything filtered out), and an
    // UNRESOLVABLE specifier is a typo'd or missing package — both surface
    // (external-package-file-discovery: silence is never an outcome).
    for (const { specifier, outcome } of this.externalPackageOutcomes) {
      if (outcome === 'empty') {
        failures.push(
          `include '${specifier}' resolved but discovered no component sources`
        );
      } else if (outcome === 'unresolvable') {
        failures.push(`include '${specifier}' could not be resolved`);
      }
    }

    if (!this.system.variableCss.includes(':root')) {
      failures.push('No :root variable block found in variable CSS');
    }

    const combined = `${this.system.variableCss}\n${this.globalCss}\n${this.resolvedComponentCss}`;
    if (combined.includes('__TRANSFORM__')) {
      failures.push(
        'Unresolved __TRANSFORM__ placeholders found in CSS output'
      );
    }

    if (this.storedManifest && this.resolvedComponentCss.length > 0) {
      const assembled = assembleStylesheet({
        layers: this.options.layers,
        variableCss: this.system.variableCss,
        globalCss: this.globalCss,
        componentCss: this.resolvedComponentCss,
      });
      const baseIdx = assembled.search(/@layer\s+anm-base\s*\{/);
      const variantsIdx = assembled.search(/@layer\s+anm-variants\s*\{/);
      if (baseIdx !== -1 && variantsIdx !== -1 && baseIdx >= variantsIdx) {
        failures.push(
          `CSS layer ordering violated — @layer anm-base (offset ${baseIdx}) must precede @layer anm-variants (offset ${variantsIdx})`
        );
      }
    }

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
