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

import type { Logger, Plugin } from 'vite';

import { evaluateThemeObject } from './theme-evaluator';

const __pluginDir = dirname(fileURLToPath(import.meta.url));

export interface AnimusExtractOptions {
  /**
   * Theme data for the extraction pipeline.
   *
   * Two forms are accepted:
   *   - `string` — pre-serialized flat JSON (legacy; no CSS variable emission)
   *   - `{ scales: string; variables: string }` — pre-evaluated scales JSON
   *     plus fully-formed CSS variable declarations to prepend to the virtual
   *     stylesheet.  The caller is responsible for evaluating the theme module
   *     (e.g. via `evaluateTheme` or a Bun subprocess) before passing it here.
   *
   * When omitted, the plugin auto-detects `src/theme.ts`, `src/theme.js`,
   * `theme.ts`, or `theme.js` relative to the project root.
   */
  theme?: string | { scales: string; variables: string };
  /**
   * Explicit path to the theme module (relative to project root or absolute).
   * Takes precedence over auto-detection, but lower priority than `theme`.
   */
  themePath?: string;
  /**
   * Path to a module exporting a SystemInstance from `@animus-ui/system`.
   * The module is loaded via a single bun subprocess at build start.
   * Replaces configPath + themePath when using the system package.
   */
  system?: string;
  /**
   * Path to a module exporting `getExtractConfig()`. The module is loaded via
   * bun subprocess at build start. Use this for custom Animus instances created
   * with `createAnimus().addGroup(...).build()`.
   *
   * When omitted, automatically imported from `@animus-ui/core`.
   */
  configPath?: string;
  /**
   * Pre-serialized prop config JSON. When omitted, automatically imported from
   * `@animus-ui/core` via `getExtractConfig()`.
   */
  config?: string;
  /** Pre-serialized group registry JSON. Maps group names to prop name arrays. */
  groupRegistry?: string;
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
 * Apply transform placeholders emitted by the Rust pipeline.
 *
 * Rust emits `__TRANSFORM__name__rawValue__` for props with transforms.
 * This function resolves each placeholder using the actual JS transform
 * functions from the config.
 */
function applyTransformPlaceholders(
  css: string,
  transformRegistry: Map<
    string,
    (value: string | number) => string | number | Record<string, any>
  >
): string {
  return css.replace(
    /__TRANSFORM__(\w+)__(.+?)__/g,
    (_match, name: string, rawValue: string) => {
      const fn = transformRegistry.get(name);
      if (!fn) {
        console.warn(
          `[animus-extract] Unknown transform: "${name}" — using raw value`
        );
        return rawValue;
      }
      // Parse numeric values back to numbers
      const value =
        rawValue !== '' && !isNaN(Number(rawValue))
          ? Number(rawValue)
          : rawValue;
      const result = fn(value);
      return typeof result === 'object'
        ? JSON.stringify(result)
        : String(result);
    }
  );
}

/**
 * CSS properties that accept unitless numeric values.
 * Matches @emotion/unitless and React DOM's style handling.
 * Bare numerics on properties NOT in this set receive `px`.
 */
const UNITLESS_PROPERTIES = new Set([
  'animation-iteration-count',
  'border-image-outset',
  'border-image-slice',
  'border-image-width',
  'box-flex',
  'box-flex-group',
  'box-ordinal-group',
  'column-count',
  'columns',
  'flex',
  'flex-grow',
  'flex-positive',
  'flex-shrink',
  'flex-negative',
  'flex-order',
  'grid-area',
  'grid-row',
  'grid-row-end',
  'grid-row-span',
  'grid-row-start',
  'grid-column',
  'grid-column-end',
  'grid-column-span',
  'grid-column-start',
  'font-weight',
  'line-clamp',
  'line-height',
  'opacity',
  'order',
  'orphans',
  'tab-size',
  'widows',
  'z-index',
  'zoom',
  'fill-opacity',
  'flood-opacity',
  'stop-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
]);

/**
 * Append `px` to bare numeric values in CSS declarations for properties
 * that expect length units. Unitless properties are preserved as-is.
 * Numbers inside CSS function calls (cubic-bezier, rgb, calc, etc.) are skipped.
 */
function applyUnitFallback(css: string): string {
  return css.replace(
    /([a-z-]+)\s*:\s*([^;{}]+);/g,
    (match, prop: string, value: string) => {
      if (UNITLESS_PROPERTIES.has(prop)) return match;
      // Strip function call contents to avoid mangling cubic-bezier(), rgb(), etc.
      // Replace numbers only OUTSIDE parenthesized expressions.
      let depth = 0;
      let fixed = '';
      let i = 0;
      while (i < value.length) {
        if (value[i] === '(') {
          depth++;
          fixed += value[i];
          i++;
        } else if (value[i] === ')') {
          depth--;
          fixed += value[i];
          i++;
        } else if (depth > 0) {
          // Inside a function call — pass through unchanged
          fixed += value[i];
          i++;
        } else {
          // Outside function calls — check for bare numbers
          const rest = value.slice(i);
          const numMatch = rest.match(/^(-?\d+\.?\d*)/);
          if (numMatch) {
            const num = numMatch[1];
            const after = value[i + num.length];
            // If followed by a letter or %, it already has a unit
            if (after && /[a-z%]/i.test(after)) {
              fixed += num;
            } else {
              fixed += num + 'px';
            }
            i += num.length;
          } else {
            fixed += value[i];
            i++;
          }
        }
      }
      return fixed !== value ? `${prop}:${fixed};` : match;
    }
  );
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
 * Resolve transform placeholders in CSS via bun subprocess.
 * Falls back to in-process resolution if the subprocess fails.
 */
function resolveTransformPlaceholders(
  css: string,
  rootDir: string,
  configPath: string | undefined,
  transformRegistry: Map<
    string,
    (value: string | number) => string | number | Record<string, any>
  >
): string {
  if (!css.includes('__TRANSFORM__')) return css;

  try {
    const ts = Date.now();
    const tmpCss = join(tmpdir(), `animus-transforms-${ts}.css`);
    const tmpOut = join(tmpdir(), `animus-transforms-${ts}.out.css`);
    writeFileSync(tmpCss, css);

    // Resolve script from multiple candidate locations
    const candidates = [
      join(__pluginDir, 'resolve-transforms.ts'),
      join(__pluginDir, '..', 'src', 'resolve-transforms.ts'),
    ];
    try {
      const pkgDir = dirname(
        require.resolve('@animus-ui/vite-plugin/package.json', {
          paths: [rootDir],
        })
      );
      candidates.push(join(pkgDir, 'src', 'resolve-transforms.ts'));
    } catch {}

    const scriptPath = candidates.find((p) => existsSync(p));
    if (!scriptPath) {
      throw new Error(
        `resolve-transforms.ts not found in: ${candidates.join(', ')}`
      );
    }
    const configArg = configPath ? `"${resolve(rootDir, configPath)}"` : '';
    execSync(`bun run "${scriptPath}" "${tmpCss}" "${tmpOut}" ${configArg}`, {
      cwd: rootDir,
      encoding: 'utf-8',
    });
    const resolved = readFileSync(tmpOut, 'utf-8');
    try {
      unlinkSync(tmpCss);
      unlinkSync(tmpOut);
    } catch {}
    return resolved;
  } catch (e: any) {
    console.error(
      '[animus-extract] Transform resolution failed:',
      e?.message || e
    );
    return applyTransformPlaceholders(css, transformRegistry);
  }
}

export function animusExtract(options: AnimusExtractOptions = {}): Plugin {
  let themeJson = '{}';
  let variableMapJson = '{}';
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

  // CSS variable declarations derived from the theme (emitted before component CSS)
  let variableCss = '';

  // Resolved CSS from .withGlobalStyles({ reset, global }) — both in @layer global { }
  let globalCss = '';

  // Transform registry: name → function, built from config at buildStart
  let transformRegistry = new Map<
    string,
    (value: string | number) => string | number | Record<string, any>
  >();

  // Manifest state — populated at buildStart, consumed during transform and load
  let storedManifest: any = null;
  let storedManifestJson = '';

  // Pre-resolved CSS with transforms applied (avoids re-resolving in load hook)
  let resolvedComponentCss = '';

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

  // Content-hash file cache for dev HMR (path → { hash, source })
  const fileCache = new Map<string, { hash: string; source: string }>();

  // Package resolution map built at buildStart (reused during HMR)
  let packageMap: Record<string, string> = {};

  // Whether the HMR bridge import has been injected into a transformed file (dev only, one-time)
  let bridgeInjected = false;

  // Resolved file paths for geological reset detection
  let resolvedConfigPath: string | null = null;
  let resolvedThemePath: string | null = null;
  let resolvedSystemPath: string | null = null;

  /** Resolve config via bun subprocess. Updates configJson + groupRegistryJson. */
  function loadConfig(): void {
    if (options.config) {
      configJson = options.config;
      groupRegistryJson = options.groupRegistry ?? groupRegistryJson;
      return;
    }

    const configSource = options.configPath
      ? resolve(rootDir, options.configPath)
      : '@animus-ui/core';
    const requireExpr = options.configPath
      ? `require('${configSource.replace(/\\/g, '/')}')`
      : `require('@animus-ui/core')`;

    // Track resolved path for HMR geological detection
    if (options.configPath) {
      resolvedConfigPath = resolve(rootDir, options.configPath);
    }

    try {
      const result = execSync(
        `bun -e "const m = ${requireExpr}; const r = m.getExtractConfig(); process.stdout.write(JSON.stringify(r))"`,
        { cwd: rootDir, encoding: 'utf-8' }
      );
      const { propConfig, groupRegistry } = JSON.parse(result);
      configJson = propConfig;
      groupRegistryJson = groupRegistry;
    } catch (e) {
      if (options.strict) {
        throw new Error(
          `[animus-extract] Failed to auto-import config from ${configSource}: ${e}`
        );
      }
      console.warn(
        `[animus-extract] Failed to auto-import config from ${configSource}:`,
        e
      );
    }
  }

  /** Resolve theme via bun subprocess. Updates themeJson + variableCss. */
  function loadTheme(): void {
    if (options.theme) {
      if (typeof options.theme === 'string') {
        themeJson = options.theme;
        variableCss = '';
      } else {
        themeJson = options.theme.scales;
        variableCss = options.theme.variables;
      }
      return;
    }

    // Determine theme file path: explicit themePath or auto-detect
    resolvedThemePath = null;

    if (options.themePath) {
      const p = resolve(rootDir, options.themePath);
      if (existsSync(p)) {
        resolvedThemePath = p;
      } else if (options.strict) {
        throw new Error(`[animus-extract] Theme file not found: ${p}`);
      } else {
        console.warn(`[animus-extract] Theme file not found: ${p}`);
      }
    } else {
      const candidates = [
        join(rootDir, 'src', 'theme.ts'),
        join(rootDir, 'src', 'theme.js'),
        join(rootDir, 'theme.ts'),
        join(rootDir, 'theme.js'),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          resolvedThemePath = candidate;
          break;
        }
      }
    }

    if (resolvedThemePath) {
      try {
        const evalScript = [
          `const m = require(${JSON.stringify(resolvedThemePath)});`,
          `const theme = m.theme || m.default;`,
          `process.stdout.write(JSON.stringify(theme || {}));`,
        ].join(' ');
        const themeJson_ = execSync(
          `bun -e "${evalScript.replace(/"/g, '\\"')}"`,
          { cwd: rootDir, encoding: 'utf-8' }
        );
        const theme = JSON.parse(themeJson_);
        if (theme && Object.keys(theme).length > 0) {
          const result = evaluateThemeObject(theme);
          themeJson = result.scalesJson;
          variableMapJson = result.variableMapJson;
          variableCss = result.variableCss;
        }
      } catch (e) {
        if (options.strict) {
          throw new Error(
            `[animus-extract] Failed to load theme from ${resolvedThemePath}: ${e}`
          );
        }
        console.warn(
          `[animus-extract] Failed to load theme from ${resolvedThemePath}:`,
          e
        );
      }
    }
  }

  /**
   * Load a SystemInstance via single bun subprocess.
   * Replaces loadConfig() + loadTheme() when `system` option is provided.
   * The subprocess imports the module and calls .serialize().
   */
  function loadSystem(): void {
    if (!options.system) return;

    resolvedSystemPath = resolve(rootDir, options.system);

    try {
      const ts = Date.now();
      const tmpScript = join(tmpdir(), `animus-system-${ts}.js`);
      const tmpOut = join(tmpdir(), `animus-system-${ts}.json`);
      writeFileSync(
        tmpScript,
        `const m = require(${JSON.stringify(resolvedSystemPath)});\n` +
          `const ds = m.ds || m.default || m.system;\n` +
          `if (!ds || !ds.serialize) { throw new Error('Module does not export a SystemInstance with .serialize()'); }\n` +
          `const cfg = ds.serialize();\n` +
          `const tokens = m.tokens || m.theme || null;\n` +
          `require('fs').writeFileSync(${JSON.stringify(tmpOut)}, JSON.stringify({\n` +
          `  propConfig: cfg.propConfig,\n` +
          `  groupRegistry: cfg.groupRegistry,\n` +
          `  tokens: tokens,\n` +
          `  transformNames: Object.keys(cfg.transforms || {}),\n` +
          `  globalStyles: cfg.globalStyles || null\n` +
          `}));\n`
      );
      execSync(`bun run "${tmpScript}"`, { cwd: rootDir, encoding: 'utf-8' });
      const result = readFileSync(tmpOut, 'utf-8');
      try {
        unlinkSync(tmpScript);
        unlinkSync(tmpOut);
      } catch {}
      const parsed = JSON.parse(result);
      configJson = parsed.propConfig;
      groupRegistryJson = parsed.groupRegistry;

      // Evaluate theme from tokens (loaded from module exports, not serialize)
      if (parsed.tokens && Object.keys(parsed.tokens).length > 0) {
        const result = evaluateThemeObject(parsed.tokens);
        themeJson = result.scalesJson;
        variableMapJson = result.variableMapJson;
        variableCss = result.variableCss;
      } else if (logger) {
        logger.warn(
          '[animus] No tokens export found in system module — CSS variables will not be generated. Export your theme as `tokens` or `theme`.'
        );
      }

      // Resolve global styles if configured.
      // Uses a bun subprocess so transform functions from the system module
      // can be applied directly (not as __TRANSFORM__ placeholders).
      // Compound shape: { reset: { selectors... }, global: { selectors... } }
      // reset → @layer reset { }, global → bare CSS before component @layers
      if (parsed.globalStyles) {
        const hasReset =
          parsed.globalStyles.reset &&
          Object.keys(parsed.globalStyles.reset).length > 0;
        const hasGlobal =
          parsed.globalStyles.global &&
          Object.keys(parsed.globalStyles.global).length > 0;

        if (hasReset || hasGlobal) {
          try {
            const gsTmp = Date.now();
            const gsThemeFile = join(tmpdir(), `animus-gs-theme-${gsTmp}.json`);
            const gsOut = join(tmpdir(), `animus-global-${gsTmp}.json`);
            writeFileSync(gsThemeFile, themeJson);

            // Resolve the script from multiple candidate locations
            const gsCandidates = [
              join(__pluginDir, 'resolve-global-styles.ts'),
              join(__pluginDir, '..', 'src', 'resolve-global-styles.ts'),
            ];
            try {
              const pkgDir = dirname(
                require.resolve('@animus-ui/vite-plugin/package.json', {
                  paths: [rootDir],
                })
              );
              gsCandidates.push(
                join(pkgDir, 'src', 'resolve-global-styles.ts')
              );
            } catch {}

            const gsScriptPath = gsCandidates.find((p) => existsSync(p));
            if (!gsScriptPath) {
              throw new Error(
                `resolve-global-styles.ts not found in: ${gsCandidates.join(', ')}`
              );
            }

            execSync(
              `bun run "${gsScriptPath}" "${resolvedSystemPath}" "${gsThemeFile}" "${gsOut}"`,
              { cwd: rootDir, encoding: 'utf-8' }
            );
            const gsResult = JSON.parse(readFileSync(gsOut, 'utf-8'));
            // Both reset and global emit into @layer global — reset first, then global.
            // Semantically separate in authoring, unified in cascade position.
            const parts = [gsResult.reset, gsResult.global].filter(Boolean);
            if (parts.length > 0) {
              globalCss = `@layer global {\n${parts.join('\n\n')}\n}`;
            }
            try {
              unlinkSync(gsThemeFile);
              unlinkSync(gsOut);
            } catch {}
          } catch (e: any) {
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
        (globalThis as any).__animus_system_resolve_script = tmpResolve;
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
   * Uses fileCache if populated (dev mode), otherwise uses provided entries.
   */
  function runAnalysis(
    fileEntries: Array<{ path: string; source: string; hash?: string }>
  ): void {
    try {
      const { analyzeProject } = require('@animus-ui/extract');
      const manifestJson = analyzeProject(
        JSON.stringify(fileEntries),
        themeJson,
        variableMapJson,
        configJson,
        groupRegistryJson,
        JSON.stringify(packageMap),
        !isProd
      );

      storedManifest = JSON.parse(manifestJson);
      storedManifestJson = manifestJson;

      // Extract shared system prop map from manifest
      const newSystemPropMapJson = JSON.stringify(
        storedManifest?.system_prop_map ?? {}
      );
      storedSystemPropMapJson = newSystemPropMapJson;

      // Reset bridge injection flag so the next transform pass re-injects it.
      // After HMR triggers a full page reload, Vite re-transforms all files —
      // the bridge import must be present in at least one for the adopted
      // stylesheet to be created in the fresh page context.
      bridgeInjected = false;

      // Store structured sheets for dev split delivery
      storedSheets = storedManifest?.sheets ?? null;

      // Pre-resolve transform placeholders
      const rawCss: string = storedManifest?.css || '';
      const systemResolveScript = (globalThis as any)
        .__animus_system_resolve_script;
      if (systemResolveScript && rawCss.includes('__TRANSFORM__') && isProd) {
        // Subprocess resolution: only in prod builds.
        // In dev, the in-process transformRegistry (loaded at buildStart) is
        // sufficient — spawning a subprocess on every HMR adds ~50ms overhead.
        try {
          const tsTmp = Date.now();
          const tmpIn = join(tmpdir(), `animus-css-${tsTmp}.css`);
          const tmpOut = join(tmpdir(), `animus-css-${tsTmp}.out.css`);
          writeFileSync(tmpIn, rawCss);
          execSync(`bun run "${systemResolveScript}" "${tmpIn}" "${tmpOut}"`, {
            cwd: rootDir,
            encoding: 'utf-8',
          });
          resolvedComponentCss = readFileSync(tmpOut, 'utf-8');
          try {
            unlinkSync(tmpIn);
            unlinkSync(tmpOut);
          } catch {}
        } catch (e: any) {
          console.warn(
            '[animus-extract] System transform resolution failed:',
            e?.message
          );
          resolvedComponentCss = resolveTransformPlaceholders(
            rawCss,
            rootDir,
            options.configPath,
            transformRegistry
          );
        }
      } else {
        resolvedComponentCss = resolveTransformPlaceholders(
          rawCss,
          rootDir,
          options.configPath,
          transformRegistry
        );
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
    },

    async buildStart() {
      // 1. Resolve config, theme, and transforms
      let t0 = performance.now();
      if (options.system) {
        // Single subprocess: system instance provides everything
        loadSystem();
      } else {
        // Legacy path: separate config and theme loading
        loadConfig();
        loadTheme();
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

        if (!isProd && storedSheets) {
          const staticSize = (
            storedSheets.declaration +
            variableCss +
            globalCss
          ).length;
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
      if (id === RESOLVED_CSS_ID) {
        if (!isProd && storedSheets) {
          // Dev mode: static CSS only (layer declaration + variables + globals)
          // Component CSS is delivered via adopted stylesheet bridge
          const parts = [
            storedSheets.declaration,
            variableCss,
            globalCss,
          ].filter(Boolean);
          return parts.join('\n');
        }
        // Prod mode: all CSS in one file (unchanged behavior)
        const parts = [variableCss, globalCss, resolvedComponentCss].filter(
          Boolean
        );
        return parts.join('\n');
      }

      if (id === RESOLVED_COMPONENTS_ID) {
        // Component CSS as a JS module exporting a string (dev only)
        // Uses resolvedComponentCss which has transforms already applied
        const css = resolvedComponentCss || '';
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
        return `
import css from '${VIRTUAL_COMPONENTS_ID}';

const GLOBAL_KEY = '__animus_component_sheet__';
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
        return `export const systemPropMap = ${storedSystemPropMapJson};\nexport const systemPropGroups = ${groupRegistryJson};`;
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

      // Geological reset: config, theme, or system file changed
      const isConfigChange =
        resolvedConfigPath && absFile === resolve(resolvedConfigPath);
      const isThemeChange =
        resolvedThemePath && absFile === resolve(resolvedThemePath);
      const isSystemChange =
        resolvedSystemPath && absFile === resolve(resolvedSystemPath);

      if (isConfigChange || isThemeChange || isSystemChange) {
        const resetStart = performance.now();
        log(`HMR geological reset: ${relPath}`);
        // Re-evaluate via subprocess
        if (isSystemChange) {
          loadSystem();
        } else {
          if (isConfigChange) loadConfig();
          if (isThemeChange) loadTheme();
        }

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

export { evaluateTheme, evaluateThemeObject } from './theme-evaluator';
export default animusExtract;
