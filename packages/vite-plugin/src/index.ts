import {
  applyUnitFallback,
  assembleStylesheet,
  assertNoRetiredEngineSelection,
  buildAnalyzeProjectArgs,
  buildDynamicPropConfig,
  buildPathAliasesJson,
  collectExternalPackageSources,
  contentHash,
  createV2EngineApi,
  DEFAULT_EXTENSIONS,
  discoverFiles,
  extractSystemFilePackages,
  formatRustTimingWaterfall,
  preprocessMdx,
  stripLeadingLayerDeclaration,
  surfaceManifestDiagnostics,
  validateLayerOrder,
} from '@animus-ui/extract/pipeline';
import browserslist from 'browserslist';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
// Lightning CSS: CSS post-processing (minification + autoprefixing)
import {
  browserslistToTargets,
  transform as lcssTransform,
} from 'lightningcss';
import { extname, relative, resolve } from 'path';

import type { V2ExtractEngine } from '@animus-ui/extract/pipeline';
import type { Logger, Plugin } from 'vite';

export { discoverFiles } from '@animus-ui/extract/pipeline';

export interface AnimusExtractOptions {
  /**
   * Path to a module exporting a SystemInstance from `@animus-ui/system`.
   * The module is loaded via Rust NAPI (OXC + rquickjs) at build start.
   * It provides prop config, group registry, theme tokens, selector aliases,
   * and global styles — everything the extraction pipeline needs.
   */
  system: string;
  /** Glob patterns to include. Defaults to .ts/.tsx/.js/.jsx files. */
  include?: string[];
  /** Glob patterns to exclude. */
  exclude?: string[];
  /**
   * File extensions to scan for component definitions and JSX usages.
   * Replaces the default list entirely (not additive). Include `.mdx` to
   * extract components rendered from MDX files — `@mdx-js/mdx` must be
   * installed as a peer for MDX files to be preprocessed; otherwise the
   * plugin warns once at buildStart and skips them.
   *
   * @default ['.ts', '.tsx', '.js', '.jsx', '.mdx']
   */
  extensions?: string[];
  /** When true, extraction failures throw instead of warning. Use in CI to enforce full extraction. */
  strict?: boolean;
  /**
   * When true, run structural self-verification at the end of `buildStart`:
   * component CSS non-empty, assembled layer ordering correct, `:root` block
   * present in variable CSS, no unresolved `__TRANSFORM__` placeholders. Prefix
   * output with `[animus:verify]`. Failures throw when `strict: true`,
   * otherwise warn.
   */
  verify?: boolean;
  /** Enable verbose logging. Also activatable via ANIMUS_DEBUG=1 env var. */
  verbose?: boolean;
  /**
   * Browser targets for CSS autoprefixing and syntax lowering.
   * Accepts a browserslist query string or array of queries.
   * Falls back to project's browserslist config, then to `defaults`.
   */
  targets?: string | string[];
  /**
   * Control CSS minification.
   * - `true`: always minify (dev + prod)
   * - `false`: never minify (autoprefixing still applies)
   * - `undefined` (default): minify in prod only
   */
  minify?: boolean;
  /**
   * Full `@layer` declaration order. Must include all 7 Animus `anm-*` layers
   * as a subsequence in their required order. Consumer layers may be
   * interleaved around them. Names are emitted as-is.
   *
   * Example: `['reset', 'anm-global', 'anm-base', ..., 'anm-custom', 'overrides']`
   */
  layers?: string[];
  /**
   * Extraction engine selection. `'v2'` is the only engine and the default.
   * The v1 engine was retired (openspec: retire-extract-v1); configuring
   * `engine: 'v1'` (or setting `ANIMUS_ENGINE=v1`) throws — the selection is
   * never silently upgraded.
   *
   * @default 'v2'
   */
  engine?: 'v2';
}

const VIRTUAL_CSS_ID = 'virtual:animus/styles.css';
const RESOLVED_CSS_ID = '\0virtual:animus/styles.css';

const VIRTUAL_COMPONENTS_ID = 'virtual:animus/components.js';
const RESOLVED_COMPONENTS_ID = '\0virtual:animus/components.js';

const VIRTUAL_BRIDGE_ID = 'virtual:animus/hmr-bridge.js';
const RESOLVED_BRIDGE_ID = '\0virtual:animus/hmr-bridge.js';

const VIRTUAL_SYSTEM_PROPS_ID = 'virtual:animus/system-props';
const RESOLVED_SYSTEM_PROPS_ID = '\0virtual:animus/system-props';

const DEFAULT_EXCLUDE = ['node_modules', 'dist', '.test.', '.spec.'];

/**
 * Resolve browser targets for Lightning CSS.
 * Priority: explicit config → project browserslist → 'defaults' fallback.
 */
function resolveLightningTargets(
  explicitTargets: string | string[] | undefined,
  rootDir: string
): ReturnType<typeof browserslistToTargets> {
  let queries: string[];
  if (explicitTargets) {
    queries = Array.isArray(explicitTargets)
      ? explicitTargets
      : [explicitTargets];
  } else {
    // Auto-detect from project's browserslist config
    const detected = browserslist(undefined, { path: rootDir });
    // browserslist() with undefined query uses the project's config or defaults
    queries = detected.length > 0 ? detected : browserslist('defaults');
  }
  return browserslistToTargets(
    Array.isArray(queries) &&
      typeof queries[0] === 'string' &&
      queries[0].includes(' ')
      ? browserslist(queries)
      : (queries as ReturnType<typeof browserslist>)
  );
}

/**
 * Post-process CSS with Lightning CSS: autoprefixing + optional minification.
 * On failure, returns the original CSS and logs a warning.
 */
function postProcessCss(
  css: string,
  opts: {
    minify: boolean;
    targets: ReturnType<typeof browserslistToTargets>;
    warnFn?: (msg: string) => void;
  }
): string {
  if (!css) return css;
  try {
    const result = lcssTransform({
      filename: 'animus-extracted.css',
      code: Buffer.from(css),
      minify: opts.minify,
      targets: opts.targets,
    });
    return result.code.toString();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const warnFn = opts.warnFn ?? console.warn;
    warnFn(`[animus] Lightning CSS post-processing failed: ${msg}`);
    return css;
  }
}

/**
 * Reconstruct file entries from cache, including content hashes.
 * For unchanged files (hash matches changedPath), sends empty source
 * to avoid serializing full source text across the NAPI boundary.
 * Rust cache-hit path never reads file.source, so empty string is safe.
 */
function buildFileEntriesFromCache(
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

export function animusExtract(options: AnimusExtractOptions): Plugin {
  // v2 is the only engine (openspec: retire-extract-v1). Reject a retired v1
  // selection loudly before any engine work — the option type no longer admits
  // 'v1', so cast to string to still catch a stale config at runtime.
  assertNoRetiredEngineSelection(options.engine as string | undefined);
  // Single engine choke-point: every native extraction call resolves its
  // module through here.
  // The package root IS the v2 engine since retire-extract-v1.
  const engineModuleId = '@animus-ui/extract';
  const requireEngine = () => require(engineModuleId);
  // Per-PLUGIN-INSTANCE v2 engine state (DEF-1: no module-level engine —
  // two differently-configured plugins in one process must not share state).
  // The engine handle is rebuilt on every runAnalysis and nulled on cache
  // clears; the analyze-time sources feed drift detection; the one-shot drift
  // flag lives alongside them. All three stay in closure variables (vite is
  // not process-singleton, unlike next which backs the same store with
  // globalThis for the ESM/CJS double-load).
  let v2Engine: V2ExtractEngine | null = null;
  let v2SentSources: Map<string, string> | null = null;
  let v2DriftWarned = false;
  // Adapt the function API onto the stateful v2 handle via the single
  // authoritative factory in @animus-ui/extract/pipeline (shared with
  // next-plugin). loadSystemModule is exported by the engine-neutral Rust
  // crate.
  const engineApi = createV2EngineApi({
    label: 'animus-extract',
    isV2: () => true,
    loadNativeEngine: requireEngine,
    // A cache-aware caller (buildFileEntriesFromCache) may send EMPTY sources
    // for unchanged files. v2 has NO Rust-side cache (DEF-7: uncached
    // re-analysis beats a cache-hit path), so re-hydrate empty sources from the
    // plugin's own file cache before analyze.
    rehydrateFilesJson: (filesJsonRaw) => {
      if (!filesJsonRaw.includes('"source":""')) return filesJsonRaw;
      const entries = JSON.parse(filesJsonRaw) as Array<{
        path: string;
        source: string;
        hash?: string;
      }>;
      for (const entry of entries) {
        if (entry.source === '') {
          entry.source = fileCache.get(entry.path)?.source ?? '';
        }
      }
      return JSON.stringify(entries);
    },
    store: {
      getEngine: () => v2Engine,
      setEngine: (engine) => {
        v2Engine = engine;
      },
      getSentSources: () => v2SentSources,
      setSentSources: (sources) => {
        v2SentSources = sources;
      },
      getDriftWarned: () => v2DriftWarned,
      setDriftWarned: (value) => {
        v2DriftWarned = value;
      },
    },
  });

  let themeJson = '{}';
  let variableMapJson = '{}';
  let contextualVarsJson = '{}';
  let configJson = '{}';
  let groupRegistryJson = '{}';
  let selectorAliasesJson: string | null = null;
  let isProd = false;
  let rootDir = '';

  // Diagnostics
  const verbose =
    options.verbose ||
    process.env.ANIMUS_DEBUG === '1' ||
    process.env.ANIMUS_DEBUG === 'true';
  let logger: Logger | null = null;

  function log(msg: string): void {
    if (verbose) {
      (logger ?? console).info(`[animus] ${msg}`);
    }
  }

  function warn(msg: string): void {
    (logger ?? console).warn(`[animus] ${msg}`);
  }

  function logTimingWaterfall(timing: Record<string, number>): void {
    if (!verbose) return;
    for (const line of formatRustTimingWaterfall(timing, {
      indent: '         ',
      labelWidth: 15,
    })) {
      log(line);
    }
  }

  // Lightning CSS: resolved browser targets (computed once at configResolved)
  let lcssTargets: ReturnType<typeof browserslistToTargets> = {};

  // CSS variable declarations derived from the theme (emitted before component CSS)
  let variableCss = '';

  // Resolved CSS from .withGlobalStyles({ reset, global }) — emitted in @layer anm-global { }
  // Populated from manifest.sheets.global after Rust-side resolution.
  let globalCss = '';

  // Raw global style blocks JSON — passed to analyzeProject for Rust-side resolution.
  let globalStyleBlocksJson: string | null = null;

  // Raw keyframes blocks JSON — keyframes() factory exports discovered via __brand.
  let keyframesBlocksJson: string | null = null;

  // Serialized path aliases from host bundler's resolve.alias config.
  // Forwarded to Rust for cross-file binding resolution of aliased imports.
  let pathAliasesJson: string | null = null;

  // File extensions — computed once at buildStart from options.extensions.
  // HMR filter uses this same Set so that consumer-configured extensions
  // apply consistently across buildStart discovery AND per-file HMR.
  let extensionsSet: ReadonlySet<string> = new Set(
    options.extensions ?? DEFAULT_EXTENSIONS
  );

  // Manifest state — populated at buildStart, consumed during transform and load
  let storedManifest: any = null;
  let storedManifestJson = '';

  // Pre-resolved CSS with transforms applied (avoids re-resolving in load hook)
  let resolvedComponentCss = '';

  // Structured per-layer CSS sheets from the Rust crate (dev split delivery).
  // Mirrors the `CssSheets` struct in packages/extract/src/css_generator.rs —
  // keep these fields in sync. The `compounds` field was previously missing
  // from this type (fixed during integration-test-infrastructure §7 investigation);
  // compound CSS was still delivered via `resolvedComponentCss` but the per-layer
  // split representation was incomplete.
  let storedSheets: {
    declaration: string;
    global: string;
    base: string;
    variants: string;
    compounds: string;
    states: string;
    system: string;
    custom: string;
  } | null = null;

  // @layer declaration for HTML injection via transformIndexHtml.
  // Computed once at buildStart from options.layers (config-time, static).
  let layerDeclaration = '';

  // Per-component CSS fragment cache for incremental HMR
  // component_id → { base?, variants?, compounds?, states? }
  let fragmentCache = new Map<
    string,
    { base?: string; variants?: string; compounds?: string; states?: string }
  >();

  // Reverse provenance: parent_id → [child_ids] for transitive invalidation
  let reverseProvenance: Record<string, string[]> = {};

  // Shared system prop map JSON (group props only, served as virtual module)
  let storedSystemPropMapJson = '{}';

  // Dynamic prop config JSON (props with detected dynamic usage)
  let storedDynamicPropsJson = '{}';

  // Serialized transform functions for dynamic props (only transforms used by dynamic props)
  let storedTransformsSource = '{}';

  // Content-hash file cache for dev HMR (path → { hash, source })
  const fileCache = new Map<string, { hash: string; source: string }>();

  // Package resolution map built at buildStart (reused during HMR)
  let packageMap: Record<string, string> = {};

  // Absolute directory prefixes for external DS packages (for transform/HMR allowlisting)
  let externalPackageDirs: string[] = [];

  // Map of external package specifier → absolute source entry path (for resolveId redirection)
  const externalSourceEntries = new Map<string, string>();

  // Dev server reference for programmatic module invalidation (set via configureServer)
  let devServer: any;

  // Whether the HMR bridge import has been injected into a transformed file (dev only, one-time)
  let bridgeInjected = false;

  // Resolved system module path for geological reset detection
  let resolvedSystemPath: string | null = null;

  /**
   * Load a SystemInstance via Rust NAPI (rquickjs bundled eval).
   * The Rust crate reads the system file, strips TS types via OXC, resolves
   * workspace package dependencies, bundles all modules, evaluates with
   * rquickjs, and returns serialized config directly — no subprocess needed.
   */
  function loadSystem(): void {
    resolvedSystemPath = resolve(rootDir, options.system);

    try {
      const { loadSystemModule } = engineApi();
      const config = loadSystemModule(resolvedSystemPath, rootDir);

      configJson = config.propConfig;
      groupRegistryJson = config.groupRegistry;
      selectorAliasesJson = config.selectorAliases || null;
      themeJson = config.scalesJson;
      variableMapJson = config.variableMapJson;
      variableCss = config.variableCss;
      contextualVarsJson = config.contextualVarsJson;
      globalStyleBlocksJson = config.globalStyleBlocks || null;
      keyframesBlocksJson = config.keyframesBlocks || null;
    } catch (e) {
      if (options.strict) {
        throw new Error(
          `[animus-extract] Failed to load system from ${resolvedSystemPath}: ${e}`,
          { cause: e }
        );
      }
      console.warn(
        `[animus-extract] Failed to load system from ${resolvedSystemPath}:`,
        e
      );
    }
  }

  /**
   * Run project analysis and update the manifest.
   *
   * Pipeline: NAPI analyzeProject → unit fallback.
   * Transforms are resolved in-process via boa_engine during Rust extraction.
   * No subprocess needed.
   */
  function runAnalysis(
    fileEntries: Array<{ path: string; source: string; hash?: string }>
  ): void {
    try {
      const { analyzeProject } = engineApi();
      const emitterConfig = JSON.stringify({
        runtime_import: '@animus-ui/system',
        css_module_id: 'virtual:animus/styles.css',
      });
      const manifestJson = analyzeProject(
        ...buildAnalyzeProjectArgs({
          filesJson: JSON.stringify(fileEntries),
          scalesJson: themeJson,
          variableMapJson,
          contextualVarsJson: contextualVarsJson || null,
          propConfigJson: configJson,
          groupRegistryJson,
          packageResolutionJson: JSON.stringify(packageMap),
          devMode: !isProd,
          emitterConfigJson: emitterConfig,
          selectorAliasesJson,
          globalStyleBlocksJson,
          pathAliasesJson,
          keyframesJson: keyframesBlocksJson,
        })
      );

      storedManifest = JSON.parse(manifestJson);
      storedManifestJson = manifestJson;
      surfaceManifestDiagnostics(storedManifest, warn);

      // Extract shared system prop map from manifest
      const newSystemPropMapJson = JSON.stringify(
        storedManifest?.system_prop_map ?? {}
      );
      storedSystemPropMapJson = newSystemPropMapJson;

      // Extract dynamic prop config from manifest
      const dynamicProps = storedManifest?.dynamic_props ?? {};
      const newDynamicPropsJson = JSON.stringify(dynamicProps);

      if (newDynamicPropsJson !== storedDynamicPropsJson) {
        storedDynamicPropsJson = newDynamicPropsJson;

        // Build dynamicPropConfig with transformName strings (not bound functions)
        // Also serialize only the transforms used by dynamic props
        const usedTransformNames = new Set<string>();
        for (const meta of Object.values(dynamicProps) as any[]) {
          if (meta.transform_name) {
            usedTransformNames.add(meta.transform_name);
          }
        }

        // Also discover transforms used by custom prop dynamic configs
        // These are embedded as transforms.{name} in component replacement strings
        if (storedManifest?.components) {
          for (const comp of Object.values(
            storedManifest.components
          ) as any[]) {
            if (comp.replacement) {
              const matches = comp.replacement.matchAll(/transforms\.(\w+)/g);
              for (const match of matches) {
                usedTransformNames.add(match[1]);
              }
            }
          }
        }

        // Transform function serialization for dynamic props is not yet
        // supported — transforms are resolved at extraction time via boa_engine
        // in Rust, not at runtime. Dynamic props with transforms will use raw values.
        storedTransformsSource = '{}';
      }

      // Reset bridge injection flag so the next transform pass re-injects it.
      bridgeInjected = false;

      // Update per-component fragment cache from manifest
      const newFragments = storedManifest?.component_fragments;
      if (newFragments && typeof newFragments === 'object') {
        fragmentCache.clear();
        for (const [id, sheets] of Object.entries(newFragments)) {
          fragmentCache.set(id, sheets as any);
        }
      }

      // Update reverse provenance for transitive invalidation
      reverseProvenance = storedManifest?.reverse_provenance ?? {};

      // Store structured sheets for dev split delivery
      storedSheets = storedManifest?.sheets ?? null;

      // Populate globalCss from Rust-resolved sheets
      globalCss = storedManifest?.sheets?.global || '';

      // CSS from Rust is fully resolved — transforms evaluated in-process via boa_engine.
      resolvedComponentCss = storedManifest?.css || '';

      // Apply unit fallback: bare numerics on length properties get `px`
      resolvedComponentCss = applyUnitFallback(resolvedComponentCss);
    } catch (e) {
      if (options.strict) {
        throw new Error(`[animus-extract] analyzeProject failed: ${e}`, {
          cause: e,
        });
      }
      console.warn('[animus-extract] analyzeProject failed:', e);
    }
  }

  function runSelfVerify(): void {
    const failures: string[] = [];

    if (Object.keys(storedManifest?.components ?? {}).length === 0) {
      failures.push(
        'No component CSS produced — check system file and include patterns'
      );
    }

    if (!variableCss.includes(':root')) {
      failures.push('No :root variable block found in variable CSS');
    }

    const combined = `${variableCss}\n${globalCss}\n${resolvedComponentCss}`;
    if (combined.includes('__TRANSFORM__')) {
      failures.push(
        'Unresolved __TRANSFORM__ placeholders found in CSS output'
      );
    }

    if (storedManifest && resolvedComponentCss.length > 0) {
      const assembled = assembleStylesheet({
        layers: options.layers,
        variableCss,
        globalCss,
        componentCss: resolvedComponentCss,
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
      if (options.strict) {
        throw new Error(line);
      }
      if (logger) {
        logger.warn(line, { timestamp: true });
      } else {
        console.warn(line);
      }
    }

    if (failures.length === 0) {
      log('[animus:verify] structural self-check passed');
    }
  }

  return {
    name: 'animus-extract',
    enforce: 'pre',

    configureServer(server) {
      devServer = server;
    },

    configResolved(config) {
      isProd = config.command === 'build';
      rootDir = config.root;
      logger = config.logger;

      // Resolve Lightning CSS browser targets once
      lcssTargets = resolveLightningTargets(options.targets, rootDir);
      log(
        `Lightning CSS targets resolved (${Object.keys(lcssTargets).length} browsers)`
      );

      // Extract path aliases from Vite's resolved config.
      // This includes aliases from vite-tsconfig-paths, manual resolve.alias, etc.
      const rawAlias = config.resolve?.alias;
      if (rawAlias) {
        const pairs: Array<{
          pattern: string;
          target: string;
          kind?: 'prefix';
        }> = [];

        if (Array.isArray(rawAlias)) {
          // Array format: [{ find: string | RegExp, replacement: string }]
          // String finds are always prefix matches — no extension sniffing.
          for (const entry of rawAlias) {
            if (
              typeof entry.find === 'string' &&
              typeof entry.replacement === 'string'
            ) {
              pairs.push({
                pattern: entry.find,
                target: entry.replacement,
                kind: 'prefix',
              });
            }
          }
        } else if (typeof rawAlias === 'object' && rawAlias !== null) {
          // Record format: { '@admin': '/abs/path/to/src' }
          for (const [key, value] of Object.entries(rawAlias)) {
            if (typeof value === 'string') {
              pairs.push({ pattern: key, target: value });
            }
          }
        }

        const built = buildPathAliasesJson(pairs, rootDir);
        if (built) {
          pathAliasesJson = built.json;
          log(`Path aliases forwarded: ${built.count} entries`);
        }
      }
    },

    async buildStart() {
      // Clear Rust-side per-file cache so stale results from a prior
      // server lifecycle never bleed into a fresh build/dev start.
      try {
        const { clearAnalysisCache } = engineApi();
        clearAnalysisCache();
      } catch {
        // clearAnalysisCache may not exist in older builds
      }

      // 1. Load system: config, theme, transforms, global styles
      let t0 = performance.now();
      loadSystem();

      // Validate layer ordering
      if (options.layers) {
        validateLayerOrder(options.layers);
        log(`Custom layers: [${options.layers.join(', ')}]`);
      }

      if (verbose) {
        const propCount = Object.keys(JSON.parse(configJson)).length;
        const groupCount = Object.keys(JSON.parse(groupRegistryJson)).length;
        log(
          `System loaded: ${propCount} props, ${groupCount} groups (${Math.round(performance.now() - t0)}ms)`
        );
      }

      // 3. Discover source files via recursive directory walk
      t0 = performance.now();
      const excludePatterns = options.exclude ?? DEFAULT_EXCLUDE;
      // Refresh the hoisted `extensionsSet` in case `options` was mutated between
      // server lifecycles. Source of truth remains `options.extensions ?? DEFAULT_EXTENSIONS`.
      extensionsSet = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
      const shouldHandleMdx = extensionsSet.has('.mdx');
      let mdxMissingDepWarned = false;
      const filePaths = discoverFiles(
        rootDir,
        rootDir,
        excludePatterns,
        extensionsSet
      );

      // 4. Read all file sources and build file entries (preprocessing MDX as we go)
      const fileEntries: Array<{
        path: string;
        source: string;
        hash?: string;
      }> = [];
      for (const filePath of filePaths) {
        try {
          let source = readFileSync(filePath, 'utf-8');
          let relPath = relative(rootDir, filePath);

          if (shouldHandleMdx && extname(filePath) === '.mdx') {
            const result = await preprocessMdx(source, relPath);
            if (result.kind === 'missing-dep') {
              if (!mdxMissingDepWarned) {
                warn(
                  '⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped'
                );
                mdxMissingDepWarned = true;
              }
              continue;
            }
            if (result.kind === 'error') {
              warn(
                `⚠ MDX preprocessing failed for ${relPath}: ${result.error}`
              );
              continue;
            }
            source = result.source!;
            // Append `.tsx` so the Rust source-type helper treats the
            // MDX-preprocessed output as tsx for parsing. The `.mdx.tsx`
            // tail preserves the original extension in diagnostic output.
            relPath = relPath + '.tsx';
          }

          const hash = !isProd ? contentHash(source) : undefined;
          fileEntries.push({ path: relPath, source, hash });

          // Populate file cache for dev HMR
          if (!isProd && hash) {
            fileCache.set(relPath, { hash, source });
          }
        } catch {
          // Skip unreadable files silently
        }
      }

      // 5. Discover external packages from system entry file imports and resolve them
      const localFileCount = fileEntries.length;
      const packageSpecifiers = extractSystemFilePackages(resolvedSystemPath!);

      externalSourceEntries.clear();

      // Shared traversal/ingest (spec: external-package-file-discovery);
      // only specifier resolution, MDX handling, and the hash/cache policy
      // below stay bundler-specific.
      const collected = await collectExternalPackageSources({
        specifiers: packageSpecifiers,
        resolveSpecifier: async (specifier) => {
          const resolved = await this.resolve(specifier);
          return resolved?.id ?? null;
        },
        rootDir,
        extensionsSet,
        hasEntry: (relPath) => fileEntries.some((e) => e.path === relPath),
        preprocessFile: async (source, relPath, absPath) => {
          if (shouldHandleMdx && extname(absPath) === '.mdx') {
            const result = await preprocessMdx(source, relPath);
            if (result.kind === 'missing-dep') {
              if (!mdxMissingDepWarned) {
                warn(
                  '⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped'
                );
                mdxMissingDepWarned = true;
              }
              return null;
            }
            if (result.kind === 'error') {
              warn(
                `⚠ MDX preprocessing failed for ${relPath}: ${result.error}`
              );
              return null;
            }
            return { source: result.source!, relPath: relPath + '.tsx' };
          }
          return { source, relPath };
        },
        onUnreadable: (relPath, err) =>
          warn(`skipped unreadable package file ${relPath}: ${String(err)}`),
      });

      packageMap = collected.packageMap;
      for (const [specifier, srcEntry] of collected.sourceEntries) {
        externalSourceEntries.set(specifier, srcEntry);
      }
      for (const entry of collected.entries) {
        const hash = !isProd ? contentHash(entry.source) : undefined;
        fileEntries.push({ path: entry.path, source: entry.source, hash });
        if (!isProd && hash) {
          fileCache.set(entry.path, { hash, source: entry.source });
        }
      }

      externalPackageDirs = collected.packageDirs;

      const packageFileCount = fileEntries.length - localFileCount;
      log(
        `Discovered ${fileEntries.length} files (${packageFileCount} from packages) (${Math.round(performance.now() - t0)}ms)`
      );

      // 6. Run project-wide analysis to produce the manifest
      t0 = performance.now();
      runAnalysis(fileEntries);

      // 7. Surface diagnostics from the manifest
      if (storedManifest) {
        const report = storedManifest.report;
        if (report) {
          log(
            `Extracted ${report.components_extracted}/${report.components_total} components (${Math.round(performance.now() - t0)}ms)`
          );
          logTimingWaterfall(storedManifest.timing ?? {});
          log(
            `Reconciliation: ${report.components_extracted} kept, ${report.variants_eliminated} variants pruned, ${report.states_eliminated} states pruned`
          );

          // Always-on elimination warnings (not gated by verbose)
          const details: Array<{
            component: string;
            kind: string;
            name?: string;
            reason: string;
          }> = report.eliminated_details || [];
          for (const d of details) {
            if (d.kind === 'component') {
              warn(`⚠ ${d.component} eliminated: ${d.reason}`);
            } else if (d.kind === 'prospective_component') {
              warn(
                `⚠ ${d.component} would be eliminated in production: ${d.reason}`
              );
            } else if (d.kind === 'variant') {
              warn(`⚠ ${d.component} variant '${d.name}' pruned: ${d.reason}`);
            } else if (d.kind === 'state') {
              warn(`⚠ ${d.component} state '${d.name}' pruned: ${d.reason}`);
            }
          }
        }

        log(
          `CSS: ${resolvedComponentCss.length} bytes (${Object.keys(storedManifest.components || {}).length} components)`
        );

        if (!isProd && storedSheets) {
          const staticCss = assembleStylesheet({
            layers: options.layers,
            variableCss,
            globalCss,
          });
          const staticSize = staticCss.length;
          const componentSize = resolvedComponentCss.length;
          log(
            `Delivery: split mode — static ${staticSize} bytes, components ${componentSize} bytes (adopted stylesheet)`
          );
        } else {
          log('Delivery: single file mode (production)');
        }
      }

      // Compute @layer declaration for HTML injection (config-time, static).
      const { declaration } = assembleStylesheet({
        layers: options.layers,
        variableCss: '',
        globalCss: '',
        split: true,
      });
      layerDeclaration = declaration;

      if (options.verify) {
        runSelfVerify();
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_CSS_ID) return RESOLVED_CSS_ID;
      if (id === VIRTUAL_COMPONENTS_ID) return RESOLVED_COMPONENTS_ID;
      if (id === VIRTUAL_BRIDGE_ID) return RESOLVED_BRIDGE_ID;
      if (id === VIRTUAL_SYSTEM_PROPS_ID) return RESOLVED_SYSTEM_PROPS_ID;

      // Redirect external DS package imports to their source entry
      // so Vite serves .ts files (transformable) instead of .mjs dist files
      const srcEntry = externalSourceEntries.get(id);
      if (srcEntry) return srcEntry;

      return null;
    },

    load(id) {
      const shouldMinify = options.minify ?? isProd;
      const lcssOpts = {
        minify: shouldMinify,
        targets: lcssTargets,
        warnFn: warn,
      };

      if (id === RESOLVED_CSS_ID) {
        if (!isProd && storedSheets) {
          const { variables, body } = assembleStylesheet({
            layers: options.layers,
            variableCss,
            globalCss,
            split: true,
          });
          const processedBody = postProcessCss(body, {
            ...lcssOpts,
            minify: false,
          });
          return [variables, processedBody].filter(Boolean).join('\n');
        }
        const { variables, body } = assembleStylesheet({
          layers: options.layers,
          variableCss,
          globalCss,
          componentCss: resolvedComponentCss,
          split: true,
        });
        const processedBody = postProcessCss(body, lcssOpts);
        return [variables, processedBody].filter(Boolean).join('\n');
      }

      if (id === RESOLVED_COMPONENTS_ID) {
        const strippedCss = stripLeadingLayerDeclaration(
          resolvedComponentCss || ''
        );
        const css = postProcessCss(strippedCss, {
          ...lcssOpts,
          minify: false,
        });
        const escaped = css
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\$/g, '\\$');
        return `export default \`${escaped}\`;`;
      }

      if (id === RESOLVED_BRIDGE_ID) {
        // HMR bridge: manages adopted stylesheet with replaceSync()
        // Uses a global reference so re-execution (HMR module re-eval) reuses
        // the existing CSSStyleSheet instead of appending duplicates.
        const sheetHash = createHash('md5')
          .update(options.system)
          .digest('hex')
          .slice(0, 8);
        return `
import css from '${VIRTUAL_COMPONENTS_ID}';

const GLOBAL_KEY = '__animus_sheet_${sheetHash}__';
let sheet = globalThis[GLOBAL_KEY] || null;

if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in document) {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    globalThis[GLOBAL_KEY] = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(css);
} else {
  // Fallback: inject or update <style> tag
  let el = document.querySelector('style[data-animus-components]');
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('data-animus-components', '');
    document.head.appendChild(el);
  }
  el.textContent = css;
}

if (import.meta.hot) {
  import.meta.hot.accept('${VIRTUAL_COMPONENTS_ID}', (newModule) => {
    if (sheet) {
      sheet.replaceSync(newModule.default);
    } else {
      const el = document.querySelector('style[data-animus-components]');
      if (el) el.textContent = newModule.default;
    }
  });
}
`;
      }

      if (id === RESOLVED_SYSTEM_PROPS_ID) {
        let moduleSource = `export const systemPropMap = ${storedSystemPropMapJson};\nexport const systemPropGroups = ${groupRegistryJson};`;
        // Always export dynamicPropConfig and transforms — even when empty.
        // Components with .props() custom dynamic configs reference transforms.{name}
        // in their replacement strings, and the import is unconditional.
        if (storedDynamicPropsJson !== '{}') {
          // Convert snake_case manifest keys to camelCase for JS consumption
          const configEntries = buildDynamicPropConfig(
            JSON.parse(storedDynamicPropsJson)
          );
          moduleSource += `\nexport const dynamicPropConfig = ${JSON.stringify(configEntries)};`;
        } else {
          moduleSource += `\nexport const dynamicPropConfig = {};`;
        }
        moduleSource += `\nexport const transforms = ${storedTransformsSource};`;
        return moduleSource;
      }

      return null;
    },

    transform(code, id) {
      // Transform runs in both dev and prod when a manifest is available
      if (!storedManifest) return null;

      // External DS packages bypass extension + node_modules filters —
      // published packages ship .mjs dist files with preserved builder chains
      const isExternalPkg = externalPackageDirs.some((dir) =>
        id.startsWith(dir)
      );

      if (!isExternalPkg) {
        // Filter by file extension (local files only)
        if (!/\.[jt]sx?$/.test(id)) return null;
        if (id.includes('node_modules')) return null;
      }

      // Only process files we know about in the manifest
      const relativePath = relative(rootDir, id);
      if (!storedManifest.files?.[relativePath]?.length) {
        // New file detection: if this file isn't in the cache, it was created
        // after buildStart. Register it and re-run analysis to pick it up.
        if (!isProd && !fileCache.has(relativePath)) {
          const hash = contentHash(code);
          fileCache.set(relativePath, { hash, source: code });
          const fileEntries = buildFileEntriesFromCache(
            fileCache,
            relativePath
          );
          runAnalysis(fileEntries);

          const compCount = storedManifest.files?.[relativePath]?.length ?? 0;
          log(
            `New file detected: ${relativePath} — ${compCount ? `${compCount} components extracted` : 'no components'}`
          );

          // Invalidate component CSS so adopted stylesheet picks up new styles
          if (compCount && devServer) {
            const compModule = devServer.moduleGraph.getModuleById(
              RESOLVED_COMPONENTS_ID
            );
            if (compModule) {
              devServer.moduleGraph.invalidateModule(compModule);
            }
            const sysPropModule = devServer.moduleGraph.getModuleById(
              RESOLVED_SYSTEM_PROPS_ID
            );
            if (sysPropModule) {
              devServer.moduleGraph.invalidateModule(sysPropModule);
            }
            // New file detection is rare (creating a component during dev).
            // Reload is the most reliable way to deliver the new CSS —
            // virtual module HMR path matching is fragile for programmatic sends.
            setTimeout(() => {
              devServer.hot.send({ type: 'full-reload' });
            }, 100);
          }
        }
        // Re-check after potential analysis
        if (!storedManifest.files?.[relativePath]?.length) return null;
      }

      try {
        const { transformFile } = engineApi();
        const result = transformFile(code, relativePath, storedManifestJson);

        if (!result.hasComponents) return null;

        let transformedCode = result.code;

        // In dev mode, inject the HMR bridge import into the first transformed file.
        // This ensures the adopted stylesheet is created before any component renders.
        if (!isProd && !bridgeInjected && storedSheets) {
          transformedCode = `import '${VIRTUAL_BRIDGE_ID}';\n${transformedCode}`;
          bridgeInjected = true;
          log('HMR bridge injected via transform');
        }

        if (verbose) {
          const compCount = storedManifest.files?.[relativePath]?.length ?? 0;
          log(`transform ${relativePath}: ${compCount} components`);
        }

        return { code: transformedCode, map: null };
      } catch (e) {
        if (options.strict) {
          throw new Error(`[animus-extract] Failed to transform ${id}: ${e}`, {
            cause: e,
          });
        }
        console.warn(`[animus-extract] Failed to transform ${id}:`, e);
        return null;
      }
    },

    transformIndexHtml: {
      order: 'pre',
      handler() {
        if (!layerDeclaration) return [];
        return [
          {
            tag: 'style',
            attrs: { 'data-animus-layers': '' },
            children: layerDeclaration,
            injectTo: 'head-prepend' as const,
          },
        ];
      },
    },

    async handleHotUpdate({ file, server: hmrServer, modules }) {
      // Only active in dev mode
      if (isProd) return;

      const ext = extname(file);
      if (!extensionsSet.has(ext)) return;

      const excludePatterns = options.exclude ?? DEFAULT_EXCLUDE;
      const isExternalPkg = externalPackageDirs.some((dir) =>
        file.startsWith(dir)
      );
      if (
        !isExternalPkg &&
        excludePatterns.some(
          (pattern) =>
            file.includes(pattern) || relative(rootDir, file).includes(pattern)
        )
      ) {
        return;
      }

      const absFile = resolve(file);
      const relPath = relative(rootDir, absFile);

      // Geological reset: system file changed
      const isSystemChange =
        resolvedSystemPath && absFile === resolve(resolvedSystemPath);

      if (isSystemChange) {
        const resetStart = performance.now();
        log(`HMR geological reset: ${relPath}`);
        loadSystem();

        // Clear Rust-side per-file cache before full re-analysis
        try {
          const { clearAnalysisCache } = engineApi();
          clearAnalysisCache();
        } catch {
          // clearAnalysisCache may not exist in older builds
        }

        // Full re-extraction with all cached files.
        // Must send full sources — Rust cache was just cleared, so all files
        // are cache misses and need real source text for OXC parsing.
        const fileEntries: Array<{
          path: string;
          source: string;
          hash: string;
        }> = [];
        for (const [path, { hash, source }] of fileCache) {
          fileEntries.push({ path, source, hash });
        }
        runAnalysis(fileEntries);

        log(
          `HMR geological reset complete: ${Math.round(performance.now() - resetStart)}ms`
        );

        // Geological reset: invalidate BOTH static CSS (vars/globals changed) AND
        // component CSS (bridge needs fresh component CSS too)
        const geologicalModules = [...modules];
        const cssModule = hmrServer.moduleGraph.getModuleById(RESOLVED_CSS_ID);
        if (cssModule) {
          hmrServer.moduleGraph.invalidateModule(cssModule);
          geologicalModules.push(cssModule);
        }
        const compModule = hmrServer.moduleGraph.getModuleById(
          RESOLVED_COMPONENTS_ID
        );
        if (compModule) {
          hmrServer.moduleGraph.invalidateModule(compModule);
          geologicalModules.push(compModule);
        }
        const sysPropModule = hmrServer.moduleGraph.getModuleById(
          RESOLVED_SYSTEM_PROPS_ID
        );
        if (sysPropModule) {
          hmrServer.moduleGraph.invalidateModule(sysPropModule);
          geologicalModules.push(sysPropModule);
        }
        return geologicalModules;
      }

      // Content-hash check: skip if unchanged
      let source: string;
      try {
        source = readFileSync(absFile, 'utf-8');
      } catch {
        return;
      }

      // Preprocess MDX sources on HMR the same way buildStart does.
      // Note: `relPath` is rewritten to end with `.tsx` so the Rust source-type
      // helper parses the preprocessed output as tsx — matching buildStart.
      let scannerRelPath = relPath;
      if (ext === '.mdx') {
        const result = await preprocessMdx(source, relPath);
        if (result.kind === 'missing-dep') {
          warn(
            '⚠ .mdx HMR skipped: @mdx-js/mdx not installed; restart dev server after installing'
          );
          return;
        }
        if (result.kind === 'error') {
          warn(`⚠ MDX preprocessing failed for ${relPath}: ${result.error}`);
          return;
        }
        source = result.source!;
        scannerRelPath = relPath + '.tsx';
      }

      const hash = contentHash(source);
      const cached = fileCache.get(scannerRelPath);
      if (cached && cached.hash === hash) {
        log(`HMR skip: ${scannerRelPath} (unchanged)`);
        return [];
      }

      // Update cache entry
      fileCache.set(scannerRelPath, { hash, source });

      const hmrStart = performance.now();

      // Snapshot previous replacements for invalidation diffing
      const prevReplacements = new Map<string, string>();
      if (storedManifest?.components) {
        for (const [id, desc] of Object.entries(storedManifest.components)) {
          prevReplacements.set(id, (desc as any).replacement ?? '');
        }
      }

      // Identify directly affected component_ids from the changed file
      const directComponentIds: string[] =
        storedManifest?.files?.[scannerRelPath] ?? [];
      // Compute transitive invalidation set via reverse_provenance BFS
      const invalidatedIds = new Set(directComponentIds);
      const queue = [...directComponentIds];
      while (queue.length > 0) {
        const parentId = queue.shift()!;
        const children = reverseProvenance[parentId];
        if (children) {
          for (const childId of children) {
            if (!invalidatedIds.has(childId)) {
              invalidatedIds.add(childId);
              queue.push(childId);
            }
          }
        }
      }

      if (verbose && invalidatedIds.size > directComponentIds.length) {
        log(
          `HMR: ${directComponentIds.length} direct + ${invalidatedIds.size - directComponentIds.length} transitive components invalidated`
        );
      }

      // Rebuild file entries from cache and re-run analysis.
      // Pass changedPath so unchanged files send empty source (skip JSON serialization).
      const analysisStart = performance.now();
      const fileEntries = buildFileEntriesFromCache(fileCache, relPath);
      runAnalysis(fileEntries);
      const analysisMs = Math.round(performance.now() - analysisStart);

      const modulesToUpdate = [...modules];

      // Invalidate component CSS module (adopted stylesheet in dev, CSS in prod)
      // Static CSS (virtual:animus/styles.css) is NOT invalidated here —
      // it only changes on geological reset (vars/globals are stable during dev)
      const compModule = hmrServer.moduleGraph.getModuleById(
        RESOLVED_COMPONENTS_ID
      );
      if (compModule) {
        hmrServer.moduleGraph.invalidateModule(compModule);
        modulesToUpdate.push(compModule);
      }

      // Invalidate shared system prop map when utility classes change
      const sysPropModule = hmrServer.moduleGraph.getModuleById(
        RESOLVED_SYSTEM_PROPS_ID
      );
      if (sysPropModule) {
        hmrServer.moduleGraph.invalidateModule(sysPropModule);
        modulesToUpdate.push(sysPropModule);
      }

      // Invalidate definition files where component replacement changed.
      // Simple string comparison — if the replacement string differs at all
      // (including systemProps), the definition file needs re-transforming.
      if (storedManifest?.components) {
        const staleFiles = new Set<string>();
        for (const [id, desc] of Object.entries(storedManifest.components)) {
          const newReplacement = (desc as any).replacement ?? '';
          const oldReplacement = prevReplacements.get(id) ?? '';
          if (newReplacement !== oldReplacement) {
            staleFiles.add((desc as any).file);
          }
        }

        for (const defFile of staleFiles) {
          const absDefPath = resolve(rootDir, defFile);
          if (absDefPath === absFile) continue;
          const defModule =
            hmrServer.moduleGraph.getModuleById(absDefPath) ??
            hmrServer.moduleGraph.getModulesByFile(absDefPath)?.values().next()
              .value;
          if (defModule) {
            log(`HMR invalidate: ${defFile} (replacement changed)`);
            hmrServer.moduleGraph.invalidateModule(defModule);
            modulesToUpdate.push(defModule);
          }
        }
      }

      const hmrMs = Math.round(performance.now() - hmrStart);
      const invalidated = modulesToUpdate.length - modules.length;
      log(
        `HMR update: ${relPath} — analysis ${analysisMs}ms, ${invalidated} modules invalidated, total ${hmrMs}ms`
      );
      logTimingWaterfall(storedManifest?.timing ?? {});

      if (modulesToUpdate.length > modules.length) {
        return modulesToUpdate;
      }
    },
  };
}

export default animusExtract;
