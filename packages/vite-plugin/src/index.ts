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

import type { Plugin } from 'vite';

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
}

const VIRTUAL_CSS_ID = 'virtual:animus/styles.css';
const RESOLVED_CSS_ID = '\0virtual:animus/styles.css';

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

/** Compute MD5 content hash for a string. */
function contentHash(source: string): string {
  return createHash('md5').update(source).digest('hex');
}

/** Reconstruct file entries array from the cache map. */
function buildFileEntriesFromCache(
  cache: Map<string, { hash: string; source: string }>
): Array<{ path: string; source: string }> {
  const entries: Array<{ path: string; source: string }> = [];
  for (const [path, { source }] of cache) {
    entries.push({ path, source });
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
  let configJson = '{}';
  let groupRegistryJson = '{}';
  let isProd = false;
  let rootDir = '';

  // CSS variable declarations derived from the theme (emitted before component CSS)
  let variableCss = '';

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

  // Content-hash file cache for dev HMR (path → { hash, source })
  const fileCache = new Map<string, { hash: string; source: string }>();

  // Package resolution map built at buildStart (reused during HMR)
  let packageMap: Record<string, string> = {};

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
          const { scalesJson, variableCss: varCss } =
            evaluateThemeObject(theme);
          themeJson = scalesJson;
          variableCss = varCss;
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
          `require('fs').writeFileSync(${JSON.stringify(tmpOut)}, JSON.stringify({\n` +
          `  propConfig: cfg.propConfig,\n` +
          `  groupRegistry: cfg.groupRegistry,\n` +
          `  tokens: cfg.tokens,\n` +
          `  transformNames: Object.keys(cfg.transforms || {})\n` +
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

      // Evaluate theme from the tokens
      if (parsed.tokens && Object.keys(parsed.tokens).length > 0) {
        const { scalesJson, variableCss: varCss } = evaluateThemeObject(
          parsed.tokens
        );
        themeJson = scalesJson;
        variableCss = varCss;
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
    fileEntries: Array<{ path: string; source: string }>
  ): void {
    try {
      const { analyzeProject } = require('@animus-ui/extract');
      const manifestJson = analyzeProject(
        JSON.stringify(fileEntries),
        themeJson,
        configJson,
        groupRegistryJson,
        JSON.stringify(packageMap)
      );

      storedManifest = JSON.parse(manifestJson);
      storedManifestJson = manifestJson;

      // Pre-resolve transform placeholders
      const rawCss: string = storedManifest?.css || '';
      const systemResolveScript = (globalThis as any)
        .__animus_system_resolve_script;
      if (systemResolveScript && rawCss.includes('__TRANSFORM__')) {
        // Use system-aware transform resolution
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
          resolvedComponentCss = rawCss;
        }
      } else {
        resolvedComponentCss = resolveTransformPlaceholders(
          rawCss,
          rootDir,
          options.configPath,
          transformRegistry
        );
      }
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
    },

    async buildStart() {
      // 1. Resolve config, theme, and transforms
      if (options.system) {
        // Single subprocess: system instance provides everything
        loadSystem();
      } else {
        // Legacy path: separate config and theme loading
        loadConfig();
        loadTheme();
      }

      // 3. Discover source files via recursive directory walk
      const excludePatterns = options.exclude ?? DEFAULT_EXCLUDE;
      const filePaths = discoverFiles(rootDir, rootDir, excludePatterns);

      // 4. Read all file sources and build file entries
      const fileEntries: Array<{ path: string; source: string }> = [];
      for (const filePath of filePaths) {
        try {
          const source = readFileSync(filePath, 'utf-8');
          const relPath = relative(rootDir, filePath);
          fileEntries.push({ path: relPath, source });

          // Populate file cache for dev HMR
          if (!isProd) {
            fileCache.set(relPath, { hash: contentHash(source), source });
          }
        } catch {
          // Skip unreadable files silently
        }
      }

      // 5. Discover package imports matching configured patterns and resolve them
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
              fileEntries.push({ path: relPath, source: entrySource });
              if (!isProd) {
                fileCache.set(relPath, {
                  hash: contentHash(entrySource),
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
                fileEntries.push({ path: pkgRelPath, source: pkgSource });
                if (!isProd) {
                  fileCache.set(pkgRelPath, {
                    hash: contentHash(pkgSource),
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

      // 6. Run project-wide analysis to produce the manifest
      runAnalysis(fileEntries);
    },

    resolveId(id) {
      if (id === VIRTUAL_CSS_ID) return RESOLVED_CSS_ID;
      return null;
    },

    load(id) {
      if (id === RESOLVED_CSS_ID) {
        // Serve pre-resolved CSS (transforms already applied at buildStart / HMR)
        return variableCss
          ? `${variableCss}\n${resolvedComponentCss}`
          : resolvedComponentCss;
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

        return { code: result.code, map: null };
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
        // Re-evaluate via subprocess
        if (isSystemChange) {
          loadSystem();
        } else {
          if (isConfigChange) loadConfig();
          if (isThemeChange) loadTheme();
        }

        // Full re-extraction with all cached files
        const fileEntries = buildFileEntriesFromCache(fileCache);
        runAnalysis(fileEntries);

        // Invalidate and include CSS module in HMR update alongside default modules
        const cssModule = hmrServer.moduleGraph.getModuleById(RESOLVED_CSS_ID);
        if (cssModule) {
          hmrServer.moduleGraph.invalidateModule(cssModule);
          return [...modules, cssModule];
        }
        return;
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
        // Content unchanged — suppress default HMR for this file
        return [];
      }

      // Update cache entry
      fileCache.set(relPath, { hash, source });

      // Rebuild file entries from cache and re-run analysis
      const fileEntries = buildFileEntriesFromCache(fileCache);
      runAnalysis(fileEntries);

      // Invalidate CSS module and include it in the HMR update alongside default
      // modules. Returning [...modules, cssModule] tells Vite to:
      // 1. HMR the changed file (default modules) → transform re-fires → new JS
      // 2. HMR the CSS virtual module → browser re-fetches → new styles
      // Both must happen together — the CSS has updated rules and the JS references
      // them via stable class names (hashed from filename::binding, not content).
      const cssModule = hmrServer.moduleGraph.getModuleById(RESOLVED_CSS_ID);
      if (cssModule) {
        hmrServer.moduleGraph.invalidateModule(cssModule);
        return [...modules, cssModule];
      }
    },
  };
}

export { evaluateTheme, evaluateThemeObject } from './theme-evaluator';
export default animusExtract;
