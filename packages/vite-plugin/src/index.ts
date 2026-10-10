import {
  assertKnownOptionKeys,
  assertNoRetiredEngineSelection,
  resolveMode,
  sourceKitDependencies,
} from '@animus-ui/extract/pipeline';
import { resolve } from 'path';

import { runBuildStart } from './build-start';
import { applyResolvedConfig } from './config';
import { PluginContext } from './context';
import { handleHotUpdate } from './hmr';
import { buildIndexHtmlTags } from './index-html';
import { transformSource } from './transform';
import { loadVirtualModule, resolveVirtualId } from './virtual-modules';

import type {
  DiagnosticLevels,
  StaticCssConfig,
} from '@animus-ui/extract/pipeline';
import type { Plugin } from 'vite';

export { discoverFiles } from '@animus-ui/extract/pipeline';

/** The optimizer would prebundle an installed source kit from its compiled
 *  entry, past the transform, so each is excluded and served as the source
 *  the redirect names; its own dependencies, which that source imports as
 *  a browser would, are prebundled in its place (`kit > dependency`). A
 *  linked kit is source to Vite already. */
function sourceKitOptimizeDeps(
  rootDir: string
): { exclude: string[]; include: string[] } | undefined {
  const kits = sourceKitDependencies(rootDir).filter((kit) => kit.installed);
  if (kits.length === 0) return undefined;
  return {
    exclude: kits.map((kit) => kit.name),
    include: kits.flatMap((kit) =>
      kit.dependencies.map((dependency) => `${kit.name} > ${dependency}`)
    ),
  };
}

export interface AnimusExtractOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /**
   * Module specifier for extracted runtime factories, default
   * `@animus-ui/system`. An override must supply every terminal used.
   */
  runtimeImport?: string;
  /**
   * Substrings, or globs when `*`/`?` present. Replaces the defaults `dist`,
   * `.test.`, `.spec.`; `node_modules`, `.next`, `.animus` always apply.
   */
  exclude?: string[];
  /**
   * Replaces the default extension list entirely. `.mdx` needs the
   * `@mdx-js/mdx` peer, or those files warn once and are skipped.
   */
  extensions?: string[];
  /**
   * Error-severity diagnostics — lost configured inputs and classified
   * unsupported Animus declarations — fail the build instead of warning.
   * Omitted or `false` warns.
   */
  strict?: boolean;
  /**
   * Each `animus.*` code's level, by exact code or a prefix ending in `.*`
   * (`'animus.style.*'`): `'off'`, `'info'`, `'warn'` or `'error'`, which
   * fails the build. An exact code beats the longest matching prefix, and an
   * entry beats `strict` and the code's own severity.
   */
  diagnostics?: DiagnosticLevels;
  /**
   * Run a structural self-check at the end of `buildStart`; failures throw
   * under `strict`, otherwise warn.
   */
  verify?: boolean;
  /** `true` logs phase checkpoints, summaries and timing (`ANIMUS_DEBUG=1`);
   *  `'trace'` also logs one line per pruned option, transformed file and
   *  HMR decision (`ANIMUS_DEBUG=trace`). */
  verbose?: boolean | 'trace';
  /**
   * Browserslist queries for autoprefixing and syntax lowering; falls back
   * to the project's browserslist config, then to `defaults`.
   */
  targets?: string | string[];
  /** Absent minifies in production only; `false` still autoprefixes. */
  minify?: boolean;
  /**
   * Emission mode. Wins over the Vite command signal, which otherwise
   * selects production for `build` and development elsewhere.
   */
  mode?: 'development' | 'production';
  /** Namespace prefix for CSS variables and class names. */
  prefix?: string;
  /** With `prefix` set, contextual variables take the prefixed name
   *  everywhere Animus emits them, while authors keep writing the declared
   *  name. */
  prefixContextualVars?: boolean;
  /**
   * Forced-emission declarations for usage the scanner cannot observe;
   * declared variants, states and prop values are emitted as if used.
   */
  staticCss?: StaticCssConfig;
  /**
   * Full `@layer` declaration order; must contain every `anm-*` layer as a
   * subsequence in its required order. Consumer layers may interleave.
   */
  layers?: string[];
  /**
   * `'v2'` is the only engine. `engine: 'v1'` or `ANIMUS_ENGINE=v1` throws
   * rather than being silently upgraded.
   */
  engine?: 'v2';
  /**
   * Delivery only: `code` is injected verbatim as an inline
   * `<script data-animus-bootstrap>`; `cspHash` is for the host's own policy.
   */
  appearanceBootstrap?: { code: string; cspHash: string };
}

type AnimusExtractOptionRecord = {
  [Key in keyof AnimusExtractOptions]: AnimusExtractOptions[Key];
};

export function animusExtract(options: AnimusExtractOptions): Plugin {
  // The option type excludes 'v1', but a raw runtime value still reaches here.
  assertNoRetiredEngineSelection(options.engine);
  // Warn, never throw: an extra key must not kill Vite config loading during
  // a consumer upgrade. Invalid `mode` values still throw.
  const optionRecord: AnimusExtractOptionRecord = options;
  assertKnownOptionKeys(
    optionRecord,
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

    // `__ANIMUS_DEV__` gates the system runtime's development-only diagnostics.
    config(userConfig, env) {
      const { mode } = resolveMode(options.mode, () =>
        env.command === 'build' ? 'production' : 'development'
      );
      const define = { __ANIMUS_DEV__: mode === 'development' };
      const optimizeDeps = sourceKitOptimizeDeps(
        resolve(userConfig.root ?? process.cwd())
      );
      return optimizeDeps ? { define, optimizeDeps } : { define };
    },

    configureServer(server) {
      ctx.devServer = server;
      // System deps can load before the server exists; workspace paths
      // outside the root get no watcher events unless registered here.
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

    async hotUpdate(hmr) {
      return handleHotUpdate(ctx, this.environment, hmr);
    },
  };
}

export default animusExtract;
