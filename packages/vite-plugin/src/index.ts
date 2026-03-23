import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
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

  return {
    name: 'animus-extract',
    enforce: 'pre',

    configResolved(config) {
      isProd = config.command === 'build';
      rootDir = config.root;
    },

    async buildStart() {
      // 1. Resolve prop config and group registry
      if (options.config) {
        // Explicit escape hatch: use pre-serialized config
        configJson = options.config;
        groupRegistryJson = options.groupRegistry ?? groupRegistryJson;
      } else {
        // Import config via bun subprocess — either from custom configPath or @animus-ui/core
        const configSource = options.configPath
          ? resolve(rootDir, options.configPath)
          : '@animus-ui/core';
        const requireExpr = options.configPath
          ? `require('${configSource.replace(/\\/g, '/')}')`
          : `require('@animus-ui/core')`;
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

      // 2. Resolve theme (priority order: theme option > themePath option > auto-detect > empty)
      if (options.theme) {
        if (typeof options.theme === 'string') {
          // Legacy: pre-serialized flat JSON — no CSS variable emission
          themeJson = options.theme;
          variableCss = '';
        } else {
          // New form: pre-evaluated { scales, variables }
          themeJson = options.theme.scales;
          variableCss = options.theme.variables;
        }
      } else {
        // Determine theme file path: explicit themePath or auto-detect
        let resolvedThemePath: string | null = null;

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
          // Auto-detect common theme file locations
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
            // Load and evaluate the theme via bun subprocess.
            // This handles TypeScript theme files (.ts) that Node's ESM loader cannot process.
            const evalScript = [
              `const m = require(${JSON.stringify(resolvedThemePath)});`,
              `const theme = m.theme || m.default;`,
              `process.stdout.write(JSON.stringify(theme || {}));`,
            ].join(' ');
            const themeJson_ = execSync(
              `bun -e "${evalScript.replace(/"/g, '\\"')}"`,
              {
                cwd: rootDir,
                encoding: 'utf-8',
              }
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
        // If nothing found, themeJson stays '{}' and variableCss stays '' — no variable emission
      }

      // In dev mode, we still need the virtual CSS module to serve variable definitions
      // but skip the full extraction pipeline (file discovery, analyzeProject, etc.)
      if (!isProd) return;

      // 2. Discover source files via recursive directory walk
      const excludePatterns = options.exclude ?? DEFAULT_EXCLUDE;
      const filePaths = discoverFiles(rootDir, rootDir, excludePatterns);

      // 3. Read all file sources and build file entries
      const fileEntries: Array<{ path: string; source: string }> = [];
      for (const filePath of filePaths) {
        try {
          const source = readFileSync(filePath, 'utf-8');
          fileEntries.push({
            path: relative(rootDir, filePath),
            source,
          });
        } catch {
          // Skip unreadable files silently
        }
      }

      // 4. Discover package imports matching configured patterns and resolve them
      const patterns = options.packagePatterns ?? ['@animus-ui/*'];
      const packageSpecifiers = new Set<string>();

      for (const entry of fileEntries) {
        // Quick regex scan for import sources matching patterns
        const importRegex = /from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(entry.source)) !== null) {
          const source = match[1];
          // Check if source matches any pattern (prefix match with wildcard)
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

      const packageMap: Record<string, string> = {};

      for (const specifier of packageSpecifiers) {
        try {
          const resolved = await this.resolve(specifier);
          if (resolved && resolved.id) {
            const absPath = resolved.id;
            const relPath = relative(rootDir, absPath);

            // Add the entry file to fileEntries if not already present
            if (!fileEntries.some((e) => e.path === relPath)) {
              const entrySource = readFileSync(absPath, 'utf-8');
              fileEntries.push({ path: relPath, source: entrySource });
            }

            // Also discover and include all source files in the package directory
            const pkgDir = dirname(absPath);
            const pkgFiles = discoverFiles(pkgDir, rootDir, excludePatterns);
            for (const pkgFile of pkgFiles) {
              const pkgRelPath = relative(rootDir, pkgFile);
              if (!fileEntries.some((e) => e.path === pkgRelPath)) {
                const pkgSource = readFileSync(pkgFile, 'utf-8');
                fileEntries.push({ path: pkgRelPath, source: pkgSource });
              }
            }

            packageMap[specifier] = relPath;
          }
        } catch {
          // Resolution failed — specifier is truly external, skip
        }
      }

      // 5. Run project-wide analysis to produce the manifest
      try {
        const { analyzeProject } = require('@animus-ui/extract');
        const manifestJson = analyzeProject(
          JSON.stringify(fileEntries),
          themeJson,
          configJson,
          groupRegistryJson,
          JSON.stringify(packageMap)
        );

        // 5. Store manifest for use in transform and load hooks
        storedManifest = JSON.parse(manifestJson);
        storedManifestJson = manifestJson;
      } catch (e) {
        if (options.strict) {
          throw new Error(`[animus-extract] analyzeProject failed: ${e}`);
        }
        console.warn('[animus-extract] analyzeProject failed:', e);
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_CSS_ID) return RESOLVED_CSS_ID;
      return null;
    },

    load(id) {
      if (id === RESOLVED_CSS_ID) {
        let componentCss: string = storedManifest?.css || '';

        // Apply transform placeholders: Rust emits __TRANSFORM__name__rawValue__,
        // the actual JS transform functions resolve them here via bun subprocess.
        if (componentCss.includes('__TRANSFORM__')) {
          try {
            const { writeFileSync, unlinkSync } = require('fs');
            const { tmpdir } = require('os');
            const ts = Date.now();
            const tmpCss = join(tmpdir(), `animus-transforms-${ts}.css`);
            const tmpOut = join(tmpdir(), `animus-transforms-${ts}.out.css`);
            writeFileSync(tmpCss, componentCss);

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
            const configArg = options.configPath
              ? `"${resolve(rootDir, options.configPath)}"`
              : '';
            execSync(
              `bun run "${scriptPath}" "${tmpCss}" "${tmpOut}" ${configArg}`,
              {
                cwd: rootDir,
                encoding: 'utf-8',
              }
            );
            componentCss = readFileSync(tmpOut, 'utf-8');
            try {
              unlinkSync(tmpCss);
              unlinkSync(tmpOut);
            } catch {}
          } catch (e: any) {
            console.error(
              '[animus-extract] Transform resolution failed:',
              e?.message || e
            );
            componentCss = applyTransformPlaceholders(
              componentCss,
              transformRegistry
            );
          }
        }

        return variableCss ? `${variableCss}\n${componentCss}` : componentCss;
      }
      return null;
    },

    transform(code, id) {
      if (!isProd || !storedManifest) return null;

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
  };
}

export { evaluateTheme, evaluateThemeObject } from './theme-evaluator';
export default animusExtract;
