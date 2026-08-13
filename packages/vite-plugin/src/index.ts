import {
  assertKnownOptionKeys,
  assertNoRetiredEngineSelection,
  resolveMode,
} from '@animus-ui/extract/pipeline';

import { runBuildStart } from './build-start';
import { applyResolvedConfig } from './config';
import { PluginContext } from './context';
import { handleHotUpdate } from './hmr';
import { buildIndexHtmlTags } from './index-html';
import { transformSource } from './transform';
import { loadVirtualModule, resolveVirtualId } from './virtual-modules';

import type { StaticCssConfig } from '@animus-ui/extract/pipeline';
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
  /**
   * Module specifier injected for extracted runtime factories.
   *
   * The default preserves the full `@animus-ui/system` runtime. Override this
   * only when the selected entry supplies every terminal present in the
   * analyzed consumer (for example, the framework-neutral class-resolver
   * entry for a consumer containing only `.asClass()` definitions).
   *
   * @default '@animus-ui/system'
   */
  runtimeImport?: string;
  /**
   * Exclusion patterns (substrings, or globs when `*`/`?` present). When
   * set, REPLACES the replaceable defaults (`dist`, `.test.`, `.spec.`);
   * `node_modules`, `.next`, and `.animus` are always excluded.
   */
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
   * Explicit dev/prod emission mode. Wins over the Vite command signal.
   * When absent, the documented default applies: production when
   * `config.command === 'build'`, development otherwise.
   */
  mode?: 'development' | 'production';
  /**
   * Namespace prefix for CSS variables and class names, applied to the
   * variable map/css (and theme + contextual vars) at system load.
   */
  prefix?: string;
  /**
   * Forced-emission declarations for usage the scanner cannot observe
   * (CMS-driven variants, spread-hidden props, dynamically selected
   * components). Declared variants/states/system-prop values and custom
   * dynamic slots are emitted as if used; entries are labeled as forced
   * in the extraction report. Empty/absent is a no-op.
   */
  staticCss?: StaticCssConfig;
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
  /**
   * Pre-generated appearance bootstrap artifact — DELIVERY ONLY.
   *
   * When set, the plugin injects `code` verbatim as an inline
   * `<script data-animus-bootstrap>` at the start of `<head>` in built HTML
   * (in dev, Vite's own client script precedes it); always ahead of every
   * stylesheet reference. When absent — or when `code` is empty — no
   * bootstrap script is emitted and the built HTML is unchanged.
   *
   * The plugin performs NO generation and interprets NO appearance semantics:
   * produce the artifact in your Vite config with `createAppearanceBootstrap`
   * from `@animus-ui/system/bootstrap` (a build-time-only subpath) and pass the
   * result through. The shape is declared structurally here so the plugin never
   * imports the generator.
   *
   * `cspHash` is carried for the application's own `script-src` policy — the
   * plugin does not read it. Serve it single-quoted, exactly as returned.
   *
   * @example
   * ```ts
   * import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';
   * import { theme } from './src/ds';
   *
   * animusExtract({ system: './src/ds.ts', appearanceBootstrap: createAppearanceBootstrap(theme) })
   * ```
   */
  appearanceBootstrap?: { code: string; cspHash: string };
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
  // Unknown top-level keys WARN naming the key (never a throw at this
  // published entry point — a consumer upgrade must not die while Vite is
  // loading the config over a previously-inert extra key); `verify` and
  // `appearanceBootstrap` are this driver's own top-level surface. `root`
  // is named loudly rather than silently ignored — this driver's root is
  // the resolved Vite root. Invalid `mode` VALUES still throw.
  assertKnownOptionKeys(
    options as unknown as Record<string, unknown>,
    ['verify', 'appearanceBootstrap'],
    [
      {
        key: 'root',
        reason:
          'the Vite driver derives its root from the resolved Vite config',
      },
    ],
    {
      onUnknownKey: 'warn',
      warn: (message) => console.warn(`[animus-extract] ${message}`),
    }
  );

  const ctx = new PluginContext(options);

  return {
    name: 'animus-extract',
    enforce: 'pre',

    // Supply the define the system runtime gates its development-only
    // diagnostics on — see @animus-ui/system's runtime/is-dev.ts for the
    // define/fold story and the expression shape it depends on. The define
    // is an emission decision: explicit `mode` wins over the command signal
    // through the shared resolver.
    config(_config, env) {
      const { mode } = resolveMode(options.mode, () =>
        env.command === 'build' ? 'production' : 'development'
      );
      return { define: { __ANIMUS_DEV__: mode === 'development' } };
    },

    configureServer(server) {
      ctx.devServer = server;
      // System deps may have loaded before the server existed; register
      // them with the watcher now (workspace paths outside the root get no
      // events otherwise).
      ctx.registerSystemWatchPaths();
    },

    configResolved(config) {
      applyResolvedConfig(ctx, config);
    },

    async buildStart() {
      await runBuildStart(
        ctx,
        async (specifier) => {
          const resolved = await this.resolve(specifier);
          return resolved?.id ?? null;
        },
        // Rollup asset emission exists in build only; dev serves resolved
        // asset() files via /@fs/ instead.
        ctx.isProd
          ? (fileName, source) =>
              this.emitFile({ type: 'asset', name: fileName, source })
          : undefined
      );
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
        return buildIndexHtmlTags(ctx);
      },
    },

    // One hook for every dev file event — update, create and delete alike.
    // Vite calls it once per environment, so the hook body claims the
    // analysis work for a single dispatch and invalidates modules in
    // `this.environment`'s own graph (see hmr.ts).
    async hotUpdate(hmr) {
      return handleHotUpdate(ctx, this.environment, hmr);
    },
  };
}

export default animusExtract;
