import {
  assembleStylesheet,
  createV2EngineApi,
  DEFAULT_EXTENSIONS,
  formatRustTimingWaterfall,
  loadSystemConfig,
  runProjectAnalysis,
  serializeStaticCss,
} from '@animus-ui/extract/pipeline';
import { resolve } from 'path';

import { VIRTUAL_CSS_ID } from './constants';

import type { AnimusExtractOptions } from './index';
import type { LightningTargets } from './css';
import type {
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

  // Package resolution map built at buildStart (reused during HMR)
  packageMap: Record<string, string> = {};

  // Absolute directory prefixes for external DS packages
  externalPackageDirs: string[] = [];

  // External package specifier → absolute source entry (resolveId redirect)
  externalSourceEntries = new Map<string, string>();

  // Dev server reference for programmatic module invalidation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  devServer: any;

  // Whether the HMR bridge import has been injected (dev only, one-time)
  bridgeInjected = false;

  // Resolved system module path for geological reset detection
  resolvedSystemPath: string | null = null;

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

    try {
      this.system = loadSystemConfig(this.engineApi, {
        systemPath: this.resolvedSystemPath,
        rootDir: this.rootDir,
        prefix: this.options.prefix,
      });
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

  runSelfVerify(): void {
    const failures: string[] = [];

    if (Object.keys(this.storedManifest?.components ?? {}).length === 0) {
      failures.push(
        'No component CSS produced — check system file and include patterns'
      );
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
