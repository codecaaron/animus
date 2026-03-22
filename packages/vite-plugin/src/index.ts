import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import type { Plugin } from 'vite';
import { evaluateTheme } from './theme-evaluator';
import { serializeConfig, serializeGroupRegistry } from './config-serializer';

export interface AnimusExtractOptions {
  /** Path to theme module. Auto-detected if omitted. */
  theme?: string;
  /** Path to prop config module. Defaults to @animus-ui/core/config. */
  config?: string;
  /** Pre-serialized group registry JSON. Maps group names to prop name arrays. */
  groupRegistry?: string;
  /** Glob patterns to include. Defaults to .ts/.tsx/.js/.jsx files. */
  include?: string[];
  /** Glob patterns to exclude. */
  exclude?: string[];
}

const VIRTUAL_CSS_ID = 'virtual:animus/styles.css';
const RESOLVED_CSS_ID = '\0virtual:animus/styles.css';

const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const DEFAULT_EXCLUDE = ['node_modules', 'dist', '.test.', '.spec.'];

function discoverFiles(
  dir: string,
  rootDir: string,
  excludePatterns: string[],
): string[] {
  const results: string[] = [];

  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relativePath = relative(rootDir, fullPath);

    // Check exclude patterns against the full path and relative path
    const shouldExclude = excludePatterns.some(
      (pattern) => fullPath.includes(pattern) || relativePath.includes(pattern),
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

export function animusExtract(options: AnimusExtractOptions = {}): Plugin {
  let themeJson = '{}';
  let configJson = '{}';
  let groupRegistryJson = '{}';
  let isProd = false;
  let rootDir = '';

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
      if (!isProd) return;

      // 1. Serialize theme, config, and group registry
      if (options.theme) {
        themeJson = options.theme;
      }
      if (options.config) {
        configJson = options.config;
      }
      if (options.groupRegistry) {
        groupRegistryJson = options.groupRegistry;
      }

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

      // 4. Run project-wide analysis to produce the manifest
      try {
        const { analyzeProject } = require('@animus-ui/extract');
        const manifestJson = analyzeProject(
          JSON.stringify(fileEntries),
          themeJson,
          configJson,
          groupRegistryJson,
        );

        // 5. Store manifest for use in transform and load hooks
        storedManifest = JSON.parse(manifestJson);
        storedManifestJson = manifestJson;
      } catch (e) {
        console.warn('[animus-extract] analyzeProject failed:', e);
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_CSS_ID) return RESOLVED_CSS_ID;
      return null;
    },

    load(id) {
      if (id === RESOLVED_CSS_ID) {
        return storedManifest?.css || '';
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
        console.warn(`[animus-extract] Failed to transform ${id}:`, e);
        return null;
      }
    },
  };
}

export { evaluateTheme } from './theme-evaluator';
export { serializeConfig, serializeGroupRegistry } from './config-serializer';
export default animusExtract;
