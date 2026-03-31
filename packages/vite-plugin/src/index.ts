import { execSync } from 'child_process';
import { createHash } from 'crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, extname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  applyPrefix,
  applyUnitFallback,
  detectRuntime,
  execSubprocess,
} from '@animus-ui/extract/pipeline';
import browserslist from 'browserslist';
// Lightning CSS: CSS post-processing (minification + autoprefixing)
import {
  browserslistToTargets,
  transform as lcssTransform,
} from 'lightningcss';
import type { Logger, Plugin } from 'vite';

const __pluginDir = dirname(fileURLToPath(import.meta.url));

export interface AnimusExtractOptions {
  /**
   * Path to a module exporting a SystemInstance from `@animus-ui/system`.
   * The module is loaded via a single bun subprocess at build start.
   * It provides prop config, group registry, theme tokens, transforms,
   * and global styles — everything the extraction pipeline needs.
   */
  system: string;
  /** Glob patterns to include. Defaults to .ts/.tsx/.js/.jsx files. */
  include?: string[];
  /** Glob patterns to exclude. */
  exclude?: string[];
  /** Package name patterns to resolve and include in analysis. Defaults to ['@animus-ui/*']. */
  packagePatterns?: string[];
  /** When true, extraction failures throw instead of warning. Use in CI to enforce full extraction. */
  strict?: boolean;
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
   * Namespace prefix for CSS variables and class names.
   * When set, all generated CSS variables become `--{prefix}-{name}`
   * and class names become `{prefix}-{Component}-{hash}`.
   * Defaults to no prefix.
   */
  prefix?: string;
  /**
   * Full `@layer` declaration order. Must include all 7 Animus layers
   * (global, base, variants, states, system, custom) as a subsequence
   * in their required order. Consumer layers may be interleaved around them.
   *
   * Example: `['reset', 'global', 'base', 'variants', 'states', 'system', 'custom', 'overrides']`
   *
   * When omitted, defaults to the 7 Animus layers.
   */
  layers?: string[];
}

const VIRTUAL_CSS_ID = 'virtual:animus/styles.css';
const RESOLVED_CSS_ID = '\0virtual:animus/styles.css';

const VIRTUAL_COMPONENTS_ID = 'virtual:animus/components.js';
const RESOLVED_COMPONENTS_ID = '\0virtual:animus/components.js';

const VIRTUAL_BRIDGE_ID = 'virtual:animus/hmr-bridge.js';
const RESOLVED_BRIDGE_ID = '\0virtual:animus/hmr-bridge.js';

const VIRTUAL_SYSTEM_PROPS_ID = 'virtual:animus/system-props';
const RESOLVED_SYSTEM_PROPS_ID = '\0virtual:animus/system-props';

const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const DEFAULT_EXCLUDE = ['node_modules', 'dist', '.test.', '.spec.'];

function discoverFiles(
  dir: string,
  rootDir: string,
  excludePatterns: string[]
): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir, { encoding: 'utf8' });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relativePath = relative(rootDir, fullPath);

    // Check exclude patterns against the full path and relative path
    const shouldExclude = excludePatterns.some(
      (pattern) => fullPath.includes(pattern) || relativePath.includes(pattern)
    );
    if (shouldExclude) continue;

    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...discoverFiles(fullPath, rootDir, excludePatterns));
    } else if (DEFAULT_EXTENSIONS.has(extname(entry))) {
      results.push(fullPath);
    }
  }

  return results;
}

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

/** Compute MD5 content hash for a string. */
function contentHash(source: string): string {
  return createHash('md5').update(source).digest('hex');
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

/**
 * The 7 Animus cascade layers in required order.
 * Consumer-provided `layers` must contain these as a subsequence.
 */
const ANIMUS_LAYERS = [
  'global',
  'base',
  'variants',
  'compounds',
  'states',
  'system',
  'custom',
] as const;

/**
 * Validate that a consumer `layers` array contains all 7 Animus layers
 * in the correct relative order. Consumer layers may be interleaved.
 *
 * @throws Error with descriptive message on violation
 */
function validateLayerOrder(layers: string[]): void {
  let cursor = 0;
  for (const layer of layers) {
    if (cursor < ANIMUS_LAYERS.length && layer === ANIMUS_LAYERS[cursor]) {
      cursor++;
    }
  }
  if (cursor < ANIMUS_LAYERS.length) {
    const missing = ANIMUS_LAYERS.slice(cursor);
    const found = ANIMUS_LAYERS.slice(0, cursor);
    // Determine if it's a missing layer or an ordering violation
    const allPresent = ANIMUS_LAYERS.every((l) => layers.includes(l));
    if (!allPresent) {
      const absent = ANIMUS_LAYERS.filter((l) => !layers.includes(l));
      throw new Error(
        `[animus] Invalid layers config: missing required layers: ${absent.join(', ')}. ` +
          `All 7 Animus layers must be present: ${ANIMUS_LAYERS.join(', ')}`
      );
    }
    throw new Error(
      `[animus] Invalid layers config: Animus layers must appear in order ` +
        `(${ANIMUS_LAYERS.join(' < ')}). ` +
        `Found ${found.join(', ')} in order, but ${missing.join(', ')} appeared out of sequence. ` +
        `Received: [${layers.join(', ')}]`
    );
  }
}

export function animusExtract(options: AnimusExtractOptions): Plugin {
  let themeJson = '{}';
  let variableMapJson = '{}';
  let contextualVarsJson = '{}';
  let configJson = '{}';
  let groupRegistryJson = '{}';
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

  // Lightning CSS: resolved browser targets (computed once at configResolved)
  let lcssTargets: ReturnType<typeof browserslistToTargets> = {};

  // CSS variable declarations derived from the theme (emitted before component CSS)
  let variableCss = '';

  // Resolved CSS from .withGlobalStyles({ reset, global }) — both in @layer global { }
  let globalCss = '';

  // Manifest state — populated at buildStart, consumed during transform and load
  let storedManifest: any = null;
  let storedManifestJson = '';

  // Pre-resolved CSS with transforms applied (avoids re-resolving in load hook)
  let resolvedComponentCss = '';

  // Closure-scoped transform resolve script path (was globalThis)
  let systemResolveScript: string | null = null;

  // Structured per-layer CSS sheets from the Rust crate (dev split delivery)
  let storedSheets: {
    declaration: string;
    base: string;
    variants: string;
    states: string;
    system: string;
    custom: string;
  } | null = null;

  // Shared system prop map JSON (group props only, served as virtual module)
  let storedSystemPropMapJson = '{}';

  // Dynamic prop config JSON (props with detected dynamic usage)
  let storedDynamicPropsJson = '{}';

  // Serialized transform functions for dynamic props (only transforms used by dynamic props)
  let storedTransformsSource = '{}';

  // Computed @layer declaration — custom (from options.layers) or default (from Rust)
  let layerDeclaration = '';

  // Content-hash file cache for dev HMR (path → { hash, source })
  const fileCache = new Map<string, { hash: string; source: string }>();

  // Package resolution map built at buildStart (reused during HMR)
  let packageMap: Record<string, string> = {};

  // Whether the HMR bridge import has been injected into a transformed file (dev only, one-time)
  let bridgeInjected = false;

  // Resolved system module path for geological reset detection
  let resolvedSystemPath: string | null = null;

  /**
   * Load a SystemInstance via single bun subprocess.
   * The subprocess imports the module and calls .serialize() to provide
   * prop config, group registry, tokens, transforms, and global styles.
   */
  function loadSystem(): void {
    resolvedSystemPath = resolve(rootDir, options.system);

    try {
      const ts = Date.now();
      const tmpOut = join(tmpdir(), `animus-system-${ts}.json`);
      const script =
        `const m = require(${JSON.stringify(resolvedSystemPath)});\n` +
        `const ds = m.ds || m.default || m.system;\n` +
        `if (!ds || !ds.serialize) { throw new Error('Module does not export a SystemInstance with .serialize()'); }\n` +
        `const cfg = ds.serialize();\n` +
        `const tokens = m.tokens || m.theme || null;\n` +
        `const serialized = tokens && typeof tokens.serialize === 'function' ? tokens.serialize() : null;\n` +
        `const globalStyleBlocks = {};\n` +
        `for (const [key, val] of Object.entries(m)) {\n` +
        `  if (val && typeof val === 'object' && val.__brand === 'GlobalStyleBlock') {\n` +
        `    globalStyleBlocks[key] = val.styles;\n` +
        `  }\n` +
        `}\n` +
        `require('fs').writeFileSync(${JSON.stringify(tmpOut)}, JSON.stringify({\n` +
        `  propConfig: cfg.propConfig,\n` +
        `  groupRegistry: cfg.groupRegistry,\n` +
        `  serialized: serialized,\n` +
        `  transformNames: Object.keys(cfg.transforms || {}),\n` +
        `  globalStyleBlocks: Object.keys(globalStyleBlocks).length > 0 ? globalStyleBlocks : null\n` +
        `}));\n`;
      execSubprocess(script, rootDir);
      const result = readFileSync(tmpOut, 'utf-8');
      try {
        unlinkSync(tmpOut);
      } catch {}
      const parsed = JSON.parse(result);
      configJson = parsed.propConfig;
      groupRegistryJson = parsed.groupRegistry;

      // Read serialized theme — subprocess calls tokens.serialize() directly
      if (parsed.serialized) {
        themeJson = parsed.serialized.scalesJson;
        variableMapJson = parsed.serialized.variableMapJson;
        variableCss = parsed.serialized.variableCss;
        contextualVarsJson = parsed.serialized.contextualVarsJson;

        // Apply namespace prefix if configured
        if (options.prefix) {
          const prefixed = applyPrefix(
            options.prefix,
            variableMapJson,
            variableCss
          );
          variableMapJson = prefixed.variableMapJson;
          variableCss = prefixed.variableCss;
        }
      } else {
        throw new Error(
          '[animus-extract] Theme must be built with createTheme().build(). ' +
            'No .serialize() method found on tokens export.'
        );
      }

      // Resolve global styles if configured.
      // Uses a bun subprocess so transform functions from the system module
      // can be applied directly (not as __TRANSFORM__ placeholders).
      // Global style blocks are discovered from module exports with __brand === 'GlobalStyleBlock'.
      if (parsed.globalStyleBlocks) {
        const hasBlocks = Object.keys(parsed.globalStyleBlocks).length > 0;

        if (hasBlocks) {
          try {
            const gsTmp = Date.now();
            const gsThemeFile = join(tmpdir(), `animus-gs-theme-${gsTmp}.json`);
            const gsOut = join(tmpdir(), `animus-global-${gsTmp}.json`);
            writeFileSync(gsThemeFile, themeJson);

            // Resolve the script from multiple candidate locations.
            // In dev (workspace): .ts in src/. Published: .mjs in dist/.
            const gsNames = [
              'resolve-global-styles.mjs',
              'resolve-global-styles.js',
              'resolve-global-styles.ts',
            ];
            const gsCandidates = gsNames.map((n) => join(__pluginDir, n));
            try {
              const pkgDir = dirname(
                require.resolve('@animus-ui/vite-plugin/package.json', {
                  paths: [rootDir],
                })
              );
              for (const n of gsNames) {
                gsCandidates.push(join(pkgDir, 'dist', n));
                gsCandidates.push(join(pkgDir, 'src', n));
              }
            } catch {}

            const gsScriptPath = gsCandidates.find((p) => existsSync(p));
            if (!gsScriptPath) {
              throw new Error(
                `resolve-global-styles not found in: ${gsCandidates.join(', ')}`
              );
            }

            const gsRuntime = detectRuntime();
            execSync(
              `${gsRuntime} run "${gsScriptPath}" "${resolvedSystemPath}" "${gsThemeFile}" "${gsOut}"`,
              { cwd: rootDir, encoding: 'utf-8' }
            );
            const gsResult = JSON.parse(readFileSync(gsOut, 'utf-8'));
            // All global style blocks emit into @layer global, in export order.
            const parts = Object.values(gsResult).filter(Boolean);
            if (parts.length > 0) {
              globalCss = `@layer global {\n${(parts as string[]).join('\n\n')}\n}`;
            }
            try {
              unlinkSync(gsThemeFile);
              unlinkSync(gsOut);
            } catch {}
          } catch (e: any) {
            if (options.strict) {
              throw new Error(
                `[animus-extract] Global styles resolution failed: ${e?.message || e}`
              );
            }
            console.warn(
              '[animus-extract] Global styles resolution failed:',
              e?.message || e
            );
          }
        }
      }

      // Build in-process transform registry by loading transforms from the system
      // We write a script that resolves each transform and outputs the results
      if (parsed.transformNames && parsed.transformNames.length > 0) {
        const tsTmp = Date.now();
        const tmpResolve = join(
          tmpdir(),
          `animus-transforms-resolve-${tsTmp}.js`
        );

        // Store the resolve script path for use during HMR transform resolution
        writeFileSync(
          tmpResolve,
          `const m = require(${JSON.stringify(resolvedSystemPath)});\n` +
            `const ds = m.ds || m.default || m.system;\n` +
            `const cfg = ds.serialize();\n` +
            `const css = require('fs').readFileSync(process.argv[2], 'utf-8');\n` +
            `const resolved = css.replace(/__TRANSFORM__(\\w+)__(.+?)__/g, (_, name, rawValue) => {\n` +
            `  const fn = cfg.transforms[name];\n` +
            `  if (!fn) return rawValue;\n` +
            `  const value = rawValue !== '' && !isNaN(Number(rawValue)) ? Number(rawValue) : rawValue;\n` +
            `  const result = fn(value);\n` +
            `  return typeof result === 'object' ? JSON.stringify(result) : String(result);\n` +
            `});\n` +
            `require('fs').writeFileSync(process.argv[3], resolved);\n`
        );

        // Store for reuse in runAnalysis
        systemResolveScript = tmpResolve;
      }
    } catch (e) {
      if (options.strict) {
        throw new Error(
          `[animus-extract] Failed to load system from ${resolvedSystemPath}: ${e}`
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
   * Pipeline: NAPI analyzeProject → transform resolution (subprocess) → unit fallback.
   * NAPI and unit fallback use @animus-ui/extract. Transform resolution stays as
   * subprocess because it needs live JS functions from the system module (ESM isolation).
   */
  function runAnalysis(
    fileEntries: Array<{ path: string; source: string; hash?: string }>
  ): void {
    try {
      const { analyzeProject } = require('@animus-ui/extract');
      const emitterConfig = JSON.stringify({
        runtime_import: '@animus-ui/system',
        css_module_id: 'virtual:animus/styles.css',
      });
      const manifestJson = analyzeProject(
        JSON.stringify(fileEntries),
        themeJson,
        variableMapJson,
        contextualVarsJson || null,
        configJson,
        groupRegistryJson,
        JSON.stringify(packageMap),
        !isProd,
        options.prefix || null,
        emitterConfig
      );

      storedManifest = JSON.parse(manifestJson);
      storedManifestJson = manifestJson;

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
        // supported — transforms are resolved at extraction time via subprocess,
        // not at runtime. Dynamic props with transforms will use raw values.
        storedTransformsSource = '{}';
      }

      // Reset bridge injection flag so the next transform pass re-injects it.
      bridgeInjected = false;

      // Store structured sheets for dev split delivery
      storedSheets = storedManifest?.sheets ?? null;

      // Pre-resolve transform placeholders via system subprocess.
      // Transforms need live JS functions — the subprocess imports the system
      // module for ESM isolation. This stays as a host concern.
      const rawCss: string = storedManifest?.css || '';
      if (systemResolveScript && rawCss.includes('__TRANSFORM__')) {
        try {
          const tsTmp = Date.now();
          const tmpIn = join(tmpdir(), `animus-css-${tsTmp}.css`);
          const tmpOut = join(tmpdir(), `animus-css-${tsTmp}.out.css`);
          writeFileSync(tmpIn, rawCss);
          const trRuntime = detectRuntime();
          execSync(
            `${trRuntime} run "${systemResolveScript}" "${tmpIn}" "${tmpOut}"`,
            {
              cwd: rootDir,
              encoding: 'utf-8',
            }
          );
          resolvedComponentCss = readFileSync(tmpOut, 'utf-8');
          try {
            unlinkSync(tmpIn);
            unlinkSync(tmpOut);
          } catch {}
        } catch (e: any) {
          if (options.strict) {
            throw new Error(
              `[animus-extract] Transform resolution failed: ${e?.message}`
            );
          }
          console.warn(
            '[animus-extract] Transform resolution failed:',
            e?.message
          );
          resolvedComponentCss = rawCss;
        }
      } else {
        resolvedComponentCss = rawCss;
      }

      // Apply unit fallback: bare numerics on length properties get `px`
      resolvedComponentCss = applyUnitFallback(resolvedComponentCss);
    } catch (e) {
      if (options.strict) {
        throw new Error(`[animus-extract] analyzeProject failed: ${e}`);
      }
      console.warn('[animus-extract] analyzeProject failed:', e);
    }
  }

  return {
    name: 'animus-extract',
    enforce: 'pre',

    configResolved(config) {
      isProd = config.command === 'build';
      rootDir = config.root;
      logger = config.logger;

      // Resolve Lightning CSS browser targets once
      lcssTargets = resolveLightningTargets(options.targets, rootDir);
      log(
        `Lightning CSS targets resolved (${Object.keys(lcssTargets).length} browsers)`
      );

      // Validate layer ordering if consumer provided custom layers
      if (options.layers) {
        validateLayerOrder(options.layers);
        log(`Custom layers: [${options.layers.join(', ')}]`);
      }

      if (options.prefix) {
        log(`Namespace prefix: "${options.prefix}"`);
      }
    },

    async buildStart() {
      // 1. Load system: config, theme, transforms, global styles
      let t0 = performance.now();
      loadSystem();
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
      const filePaths = discoverFiles(rootDir, rootDir, excludePatterns);

      // 4. Read all file sources and build file entries
      const fileEntries: Array<{
        path: string;
        source: string;
        hash?: string;
      }> = [];
      for (const filePath of filePaths) {
        try {
          const source = readFileSync(filePath, 'utf-8');
          const relPath = relative(rootDir, filePath);
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

      // 5. Discover package imports matching configured patterns and resolve them
      const localFileCount = fileEntries.length;
      const patterns = options.packagePatterns ?? ['@animus-ui/*'];
      const packageSpecifiers = new Set<string>();

      for (const entry of fileEntries) {
        const importRegex = /from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(entry.source)) !== null) {
          const source = match[1];
          for (const pattern of patterns) {
            const prefix = pattern.replace('*', '');
            if (
              source.startsWith(prefix) ||
              source === pattern.replace('/*', '')
            ) {
              packageSpecifiers.add(source);
            }
          }
        }
      }

      packageMap = {};

      for (const specifier of packageSpecifiers) {
        try {
          const resolved = await this.resolve(specifier);
          if (resolved && resolved.id) {
            const absPath = resolved.id;
            const relPath = relative(rootDir, absPath);

            if (!fileEntries.some((e) => e.path === relPath)) {
              const entrySource = readFileSync(absPath, 'utf-8');
              const entryHash = !isProd ? contentHash(entrySource) : undefined;
              fileEntries.push({
                path: relPath,
                source: entrySource,
                hash: entryHash,
              });
              if (!isProd && entryHash) {
                fileCache.set(relPath, {
                  hash: entryHash,
                  source: entrySource,
                });
              }
            }

            const pkgDir = dirname(absPath);
            const pkgFiles = discoverFiles(pkgDir, rootDir, excludePatterns);
            for (const pkgFile of pkgFiles) {
              const pkgRelPath = relative(rootDir, pkgFile);
              if (!fileEntries.some((e) => e.path === pkgRelPath)) {
                const pkgSource = readFileSync(pkgFile, 'utf-8');
                const pkgHash = !isProd ? contentHash(pkgSource) : undefined;
                fileEntries.push({
                  path: pkgRelPath,
                  source: pkgSource,
                  hash: pkgHash,
                });
                if (!isProd && pkgHash) {
                  fileCache.set(pkgRelPath, {
                    hash: pkgHash,
                    source: pkgSource,
                  });
                }
              }
            }

            packageMap[specifier] = relPath;
          }
        } catch {
          // Resolution failed — specifier is truly external, skip
        }
      }

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
            } else if (d.kind === 'variant') {
              warn(`⚠ ${d.component} variant '${d.name}' pruned: ${d.reason}`);
            } else if (d.kind === 'state') {
              warn(`⚠ ${d.component} state '${d.name}' pruned: ${d.reason}`);
            }
          }
        }

        // Always-on extraction diagnostics (bail + skip warnings)
        const diagnostics: Array<{
          file: string;
          component: string;
          kind: string;
          message: string;
        }> = storedManifest.diagnostics || [];
        for (const d of diagnostics) {
          if (d.kind === 'bail') {
            warn(`⚠ ${d.component} not extracted: ${d.message}`);
          } else if (d.kind === 'skip') {
            warn(`⚠ ${d.component}: skipped ${d.message}`);
          }
        }

        log(
          `CSS: ${resolvedComponentCss.length} bytes (${Object.keys(storedManifest.components || {}).length} components)`
        );

        // Compute @layer declaration: custom layers override Rust default
        if (options.layers) {
          layerDeclaration = `@layer ${options.layers.join(', ')};\n`;
        } else if (storedSheets) {
          layerDeclaration = storedSheets.declaration;
        } else {
          // Prod mode: Rust embeds @layer in the full CSS output.
          // Generate a standalone declaration for prepending.
          layerDeclaration = `@layer ${ANIMUS_LAYERS.join(', ')};\n`;
        }

        if (!isProd && storedSheets) {
          const staticSize = (layerDeclaration + variableCss + globalCss)
            .length;
          const componentSize = resolvedComponentCss.length;
          log(
            `Delivery: split mode — static ${staticSize} bytes, components ${componentSize} bytes (adopted stylesheet)`
          );
        } else {
          log('Delivery: single file mode (production)');
        }
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_CSS_ID) return RESOLVED_CSS_ID;
      if (id === VIRTUAL_COMPONENTS_ID) return RESOLVED_COMPONENTS_ID;
      if (id === VIRTUAL_BRIDGE_ID) return RESOLVED_BRIDGE_ID;
      if (id === VIRTUAL_SYSTEM_PROPS_ID) return RESOLVED_SYSTEM_PROPS_ID;
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
          // Dev mode: static CSS only (layer declaration + variables + globals)
          // Component CSS is delivered via adopted stylesheet bridge
          const parts = [layerDeclaration, variableCss, globalCss].filter(
            Boolean
          );
          return postProcessCss(parts.join('\n'), {
            ...lcssOpts,
            minify: false,
          });
        }
        // Prod mode: layer declaration + variables + globals + component CSS
        // When custom layers are configured, our declaration prepends Rust's
        // (first @layer declaration wins per CSS spec)
        const parts = [
          layerDeclaration,
          variableCss,
          globalCss,
          resolvedComponentCss,
        ].filter(Boolean);
        return postProcessCss(parts.join('\n'), lcssOpts);
      }

      if (id === RESOLVED_COMPONENTS_ID) {
        // Component CSS as a JS module exporting a string (dev only)
        // Post-process with autoprefixing but no minification (dev readability)
        const css = postProcessCss(resolvedComponentCss || '', {
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
          const dynamicProps = JSON.parse(storedDynamicPropsJson);
          const configEntries: Record<string, any> = {};
          for (const [propName, meta] of Object.entries(dynamicProps) as [
            string,
            any,
          ][]) {
            configEntries[propName] = {
              varName: meta.var_name,
              slotClass: meta.slot_class,
              ...(meta.transform_name
                ? { transformName: meta.transform_name }
                : {}),
              ...(meta.scale_values && Object.keys(meta.scale_values).length > 0
                ? { scaleValues: meta.scale_values }
                : {}),
            };
          }
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

      // Filter by file extension
      if (!/\.[jt]sx?$/.test(id)) return null;
      if (id.includes('node_modules')) return null;

      // Only process files we know about in the manifest
      const relativePath = relative(rootDir, id);
      if (!storedManifest.files?.[relativePath]?.length) return null;

      try {
        const { transformFile } = require('@animus-ui/extract');
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
          throw new Error(`[animus-extract] Failed to transform ${id}: ${e}`);
        }
        console.warn(`[animus-extract] Failed to transform ${id}:`, e);
        return null;
      }
    },

    handleHotUpdate({ file, server: hmrServer, modules }) {
      // Only active in dev mode
      if (isProd) return;

      const ext = extname(file);
      if (!DEFAULT_EXTENSIONS.has(ext)) return;

      const excludePatterns = options.exclude ?? DEFAULT_EXCLUDE;
      if (
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
          const { clearAnalysisCache } = require('@animus-ui/extract');
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

      const hash = contentHash(source);
      const cached = fileCache.get(relPath);
      if (cached && cached.hash === hash) {
        log(`HMR skip: ${relPath} (unchanged)`);
        return [];
      }

      // Update cache entry
      fileCache.set(relPath, { hash, source });

      const hmrStart = performance.now();

      // Snapshot previous replacements for invalidation diffing
      const prevReplacements = new Map<string, string>();
      if (storedManifest?.components) {
        for (const [id, desc] of Object.entries(storedManifest.components)) {
          prevReplacements.set(id, (desc as any).replacement ?? '');
        }
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

      if (modulesToUpdate.length > modules.length) {
        return modulesToUpdate;
      }
    },
  };
}

export default animusExtract;
