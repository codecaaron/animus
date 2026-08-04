import {
  assembleStylesheet,
  createV2EngineApi,
  DEFAULT_EXTENSIONS,
  clearEngineCache,
  formatRustTimingWaterfall,
  loadSystemConfig,
  runProjectAnalysis,
  serializeStaticCss,
  toWatchKeys,
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
 * the state it touches, and the engine store (DEF-1: per-instance, never
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

  // Per-component CSS fragment cache for incremental HMR
  fragmentCache = new Map<
    string,
    { base?: string; variants?: string; compounds?: string; states?: string }
  >();

  // Reverse provenance: parent_id → [child_ids] for transitive invalidation
  reverseProvenance: Record<string, string[]> = {};

  // System-props module inputs (served as virtual:animus/system-props)
  storedSystemPropMapJson = '{}';
  storedDynamicPropsJson = '{}';
  // Runtime transform functions for dynamic props are not supported —
  // transforms resolve at extraction time via boa_engine in Rust.
  storedTransformsSource = '{}';

  // Content-hash file cache for dev HMR (path → { hash, source })
  fileCache = new Map<string, { hash: string; source: string }>();

  // Once-per-file-event coordination across the per-environment `hotUpdate`
  // dispatches (see hmr.ts) — the analysis half runs for one of them.
  readonly hotUpdateEvents = new HotUpdateEvents();

  // Package resolution map built at buildStart (reused during HMR)
  packageMap: Record<string, string> = {};

  // Absolute directory prefixes for external DS packages
  externalPackageDirs: string[] = [];

  // External package specifier → absolute source entry (resolveId redirect)
  externalSourceEntries = new Map<string, string>();

  // Per-specifier discovery outcomes from buildStart (self-verify input)
  externalPackageOutcomes: ExternalPackageOutcome[] = [];

  // Dev server reference for programmatic module invalidation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  devServer: any;

  // Whether the HMR bridge import has been injected (dev only, one-time)
  bridgeInjected = false;

  // Resolved system module path for geological reset detection
  resolvedSystemPath: string | null = null;

  // Membership keys (lexical + canonical, via toWatchKeys) for every module
  // the loader evaluated for the current system — the geological-reset set.
  // A failed non-strict reload keeps the last successful set (plus the
  // entry), matching the stale config still being served.
  systemDependencyKeys: Set<string> = new Set();

  // The loader-reported dependency paths as-is, for watcher registration.
  systemDependencyPaths: string[] = [];

  // Per-PLUGIN-INSTANCE v2 engine state (DEF-1: no module-level engine —
  // two differently-configured plugins in one process must not share state).
  private v2Engine: V2ExtractEngine | null = null;
  private v2SentSources: Map<string, string> | null = null;
  private v2DriftWarned = false;

  /** Single engine choke-point for every native extraction call. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly engineApi: () => any;

  constructor(options: AnimusExtractOptions) {
    this.options = options;
    this.staticCssJson = serializeStaticCss(options.staticCss);
    this.verbose =
      options.verbose ||
      process.env.ANIMUS_DEBUG === '1' ||
      process.env.ANIMUS_DEBUG === 'true';
    this.extensionsSet = new Set(options.extensions ?? DEFAULT_EXTENSIONS);

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
      // sources for unchanged files. v2 has NO Rust-side cache (DEF-7), so
      // re-hydrate empty sources from the file cache before analyze.
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
        devMode: !this.isProd,
        warn: (m) => this.warn(m),
      });

      this.storedManifest = result.manifest;
      this.storedManifestJson = result.manifestJson;

      this.storedSystemPropMapJson = JSON.stringify(
        result.manifest?.system_prop_map ?? {}
      );
      this.storedDynamicPropsJson = JSON.stringify(
        result.manifest?.dynamic_props ?? {}
      );

      // Reset bridge injection so the next transform pass re-injects it.
      this.bridgeInjected = false;

      // Update per-component fragment cache from manifest
      const newFragments = result.manifest?.component_fragments;
      if (newFragments && typeof newFragments === 'object') {
        this.fragmentCache.clear();
        for (const [id, sheets] of Object.entries(newFragments)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.fragmentCache.set(id, sheets as any);
        }
      }

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
    }
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
    this.resetCoalescer ??= new ResetCoalescer(() =>
      this.performGeologicalReset()
    );
    this.resetCoalescer.request();
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
    // survives (ANI-010). node_modules-installed packages remain unwatchable
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

  runSelfVerify(): void {
    const failures: string[] = [];

    if (Object.keys(this.storedManifest?.components ?? {}).length === 0) {
      failures.push(
        'No component CSS produced — check the system file and its includes list'
      );
    }

    // A declared include that resolved but yielded nothing is a silent
    // misconfiguration (empty src/, everything filtered out). An UNRESOLVABLE
    // specifier is deliberately not flagged — silent skip is spec-mandated
    // (external-package-file-discovery).
    for (const { specifier, outcome } of this.externalPackageOutcomes) {
      if (outcome === 'empty') {
        failures.push(
          `include '${specifier}' resolved but discovered no component sources`
        );
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
