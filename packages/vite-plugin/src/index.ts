import { assertNoRetiredEngineSelection } from '@animus-ui/extract/pipeline';

import { runBuildStart } from './build-start';
import { applyResolvedConfig } from './config';
import { PluginContext } from './context';
import { handleHotUpdate } from './hmr';
import { transformSource } from './transform';
import { loadVirtualModule, resolveVirtualId } from './virtual-modules';

import type { Plugin } from 'vite';

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
   * Namespace prefix for CSS variables and class names, applied to the
   * variable map/css (and theme + contextual vars) at system load.
   */
  prefix?: string;
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

/**
 * Vite adapter for the extraction pipeline. State and pipeline operations
 * live in PluginContext; hook bodies live in their own modules — this
 * factory only validates options and wires Vite hooks to those functions.
 */
export function animusExtract(options: AnimusExtractOptions): Plugin {
  // v2 is the only engine (openspec: retire-extract-v1). Reject a retired v1
  // selection loudly before any engine work — the option type no longer admits
  // 'v1', so cast to string to still catch a stale config at runtime.
  assertNoRetiredEngineSelection(options.engine as string | undefined);

  const ctx = new PluginContext(options);

  return {
    name: 'animus-extract',
    enforce: 'pre',

    configureServer(server) {
      ctx.devServer = server;
    },

    configResolved(config) {
      applyResolvedConfig(ctx, config);
    },

    async buildStart() {
      await runBuildStart(ctx, async (specifier) => {
        const resolved = await this.resolve(specifier);
        return resolved?.id ?? null;
      });
    },

    resolveId(id) {
      return resolveVirtualId(ctx, id);
    },

    load(id) {
      return loadVirtualModule(ctx, id);
    },

    transform(code, id) {
      return transformSource(ctx, code, id);
    },

    transformIndexHtml: {
      order: 'pre',
      handler() {
        if (!ctx.layerDeclaration) return [];
        return [
          {
            tag: 'style',
            attrs: { 'data-animus-layers': '' },
            children: ctx.layerDeclaration,
            injectTo: 'head-prepend' as const,
          },
        ];
      },
    },

    async handleHotUpdate(hmr) {
      return handleHotUpdate(ctx, hmr);
    },
  };
}

export default animusExtract;
