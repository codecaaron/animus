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

const VIRTUAL_PREFIX = 'virtual:animus/';
const RESOLVED_PREFIX = '\0virtual:animus/';

export function animusExtract(options: AnimusExtractOptions = {}): Plugin {
  let themeJson = '{}';
  let configJson = '{}';
  let groupRegistryJson = '{}';
  let isProd = false;

  // Store extracted CSS per file
  const cssStore = new Map<string, string>();

  // Track if @layer declaration has been emitted
  let layerDeclEmitted = false;

  return {
    name: 'animus-extract',
    enforce: 'pre',

    configResolved(config) {
      isProd = config.command === 'build';
    },

    async buildStart() {
      if (!isProd) return;

      // Theme evaluation requires Vite's ssrLoadModule which is available
      // on the server instance. For now, accept pre-serialized JSON via options
      // or auto-evaluate when a Vite server context is available.
      if (options.theme) {
        // Will be wired to ssrLoadModule when integrated with real Vite builds
        // For direct usage, theme can be pre-serialized
        themeJson = options.theme;
      }
      if (options.config) {
        configJson = options.config;
      }
      if (options.groupRegistry) {
        groupRegistryJson = options.groupRegistry;
      }
    },

    resolveId(id) {
      if (!isProd) return null;
      if (id.startsWith(VIRTUAL_PREFIX)) {
        return RESOLVED_PREFIX + id.slice(VIRTUAL_PREFIX.length);
      }
      return null;
    },

    load(id) {
      if (!isProd) return null;
      if (id.startsWith(RESOLVED_PREFIX)) {
        const fileId = id.slice(RESOLVED_PREFIX.length);
        const css = cssStore.get(fileId) || '';

        // Prepend @layer declaration to the first CSS module loaded
        if (!layerDeclEmitted && css) {
          layerDeclEmitted = true;
          return `@layer base, variants, states, system, custom;\n${css}`;
        }

        return css;
      }
      return null;
    },

    transform(code, id) {
      if (!isProd) return null;

      // Filter by file extension
      if (!/\.[jt]sx?$/.test(id)) return null;
      if (id.includes('node_modules')) return null;

      // Skip excluded patterns
      if (options.exclude?.some((pattern) => id.includes(pattern))) {
        return null;
      }

      // Only process included patterns if specified
      if (
        options.include &&
        !options.include.some((pattern) => id.includes(pattern))
      ) {
        return null;
      }

      try {
        const { extract } = require('@animus-ui/extract');
        const result = extract(code, id, themeJson, configJson, groupRegistryJson);

        if (!result.extractable) {
          return null;
        }

        // Store extracted CSS
        const cssModuleId = id.replace(/\//g, '__');
        cssStore.set(cssModuleId, result.css);

        return {
          code: result.code,
          map: result.sourceMap || null,
        };
      } catch (e) {
        console.warn(`[animus-extract] Failed to extract ${id}:`, e);
        return null;
      }
    },
  };
}

export { evaluateTheme } from './theme-evaluator';
export { serializeConfig, serializeGroupRegistry } from './config-serializer';
export default animusExtract;
