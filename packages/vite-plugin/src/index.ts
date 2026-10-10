import {
  assertKnownOptionKeys,
  assertNoRetiredEngineSelection,
  isPathWithinRoot,
  kitSourceModuleSideEffects,
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
interface SourceKitConfig {
  optimizeDeps: { exclude: string[]; include: string[] };
  ssr?: { noExternal: string[] };
}

function sourceKitConfig(
  rootDir: string,
  serving: boolean
): SourceKitConfig | undefined {
  const kits = sourceKitDependencies(rootDir).filter((kit) => kit.installed);
  if (kits.length === 0) return undefined;
  const names = kits.map((kit) => kit.name);
  const config: SourceKitConfig = {
    optimizeDeps: {
      exclude: names,
      include: kits.flatMap((kit) =>
        kit.dependencies.map((dependency) => `${kit.name} > ${dependency}`)
      ),
    },
  };
  // Dev SSR externalizes an installed package and loads its runtime dist,
  // so the server renders what the client, served the source, does not.
  // A build already reads the source.
  if (serving) config.ssr = { noExternal: names };
  return config;
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
   * unsupported Animus declarations — and failed checks, such as an
   * unresolved include or `asset()` specifier or a failed `verify`
   * self-check, fail a build instead of warning. The dev server reports them
   * and keeps running; a system that fails to load at startup, or a first
   * analysis that throws, still stops it, since nothing exists to serve.
   * Omitted or `false` warns.
   */
  strict?: boolean;
  /**
   * Each `animus.*` code's level, by exact code, by a prefix ending in `.*`
   * (`'animus.style.*'`), or by kind (`'kind:bail'`, `'kind:skip'`,
   * `'kind:warn'`, `'kind:error'`): `'off'`, `'info'`, `'warn'` or `'error'`,
   * which fails a build and is reported by the dev server, which keeps
   * running. An exact code beats the longest matching prefix, which beats a
   * kind, and an entry beats `strict` and the code's own severity.
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
  /** Namespace prefix for the names Animus generates: theme token
   *  variables, classes and slots. Contextual variables keep their declared
   *  names unless `prefixContextualVars` is set. */
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
      const kits = sourceKitConfig(
        resolve(userConfig.root ?? process.cwd()),
        env.command === 'serve'
      );
      return kits ? { define, ...kits } : { define };
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

    async resolveId(id, importer) {
      const virtual = resolveVirtualId(ctx, id);
      if (virtual !== null || !id.startsWith('.') || importer === undefined) {
        return virtual;
      }
      // A kit module's import, which the package's list may misclassify.
      const importerPath = importer.split('?')[0];
      if (
        !ctx.externalPackageDirs.some((dir) =>
          isPathWithinRoot(dir, importerPath)
        )
      ) {
        return null;
      }
      const resolved = await this.resolve(id, importer, { skipSelf: true });
      if (
        resolved === null ||
        kitSourceModuleSideEffects(resolved.id.split('?')[0]) !== true
      ) {
        return null;
      }
      return { ...resolved, moduleSideEffects: true };
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
