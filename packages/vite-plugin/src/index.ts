import {
  assertKnownOptionKeys,
  assertSupportedEngine,
  isPathWithinRoot,
  keepsKitSourceEffects,
  resolveMode,
  sourceKitDependencies,
  systemKitDependencies,
} from '@animus-ui/extract/pipeline';
import { resolve } from 'path';
import { mergeConfig } from 'vite';

import { runBuildStart } from './build-start';
import { applyResolvedConfig } from './config';
import { RESOLVED_CSS_ID } from './constants';
import { PluginContext } from './context';
import { cancelSystemReload, handleHotUpdate } from './hmr';
import { buildIndexHtmlTags } from './index-html';
import { quarantinePlugin } from './quarantine-plugin';
import { transformSource } from './transform';
import { loadVirtualModule, resolveVirtualId } from './virtual-modules';
import { kitWatchNegations } from './watch-ignored';

import type {
  AnimusQuarantineOptions,
  ClosedDynamicImport,
  DiagnosticLevels,
  SourceKitDependency,
  StaticCssConfig,
} from '@animus-ui/extract/pipeline';
import type { Plugin, UserConfig } from 'vite';

export { discoverFiles } from '@animus-ui/extract/pipeline';
export type { AnimusQuarantineOptions } from '@animus-ui/extract/pipeline';

/** The optimizer would prebundle an installed kit past the transform: a
 *  source kit from its compiled entry, and a compiled kit with its builder
 *  code raw. So every installed kit is excluded and served through the
 *  transform (a source kit as the source its redirect names); its own
 *  dependencies, which that module imports as a browser would, are
 *  prebundled in its place (`kit > dependency`). A kit is one that declares
 *  the source condition, or one the system extends. A linked kit is source
 *  to Vite already. */
interface SourceKitConfig {
  optimizeDeps: { exclude: string[]; include: string[] };
  ssr: { noExternal: string[] };
  /** The installed kits' directories. */
  roots: string[];
}

async function sourceKitConfig(
  rootDir: string,
  systemPath: string,
  engine: Parameters<typeof sourceKitDependencies>[1] &
    Parameters<typeof systemKitDependencies>[2]
): Promise<SourceKitConfig | undefined> {
  const kits = new Map<string, SourceKitDependency>();
  for (const kit of [
    ...sourceKitDependencies(rootDir, engine),
    ...(await systemKitDependencies(rootDir, systemPath, engine)),
  ]) {
    if (kit.installed && !kits.has(kit.name)) kits.set(kit.name, kit);
  }
  if (kits.size === 0) return undefined;
  const names = [...kits.keys()];
  return {
    optimizeDeps: {
      exclude: names,
      include: [...kits.values()].flatMap((kit) =>
        kit.dependencies.map((dependency) => `${kit.name} > ${dependency}`)
      ),
    },
    // SSR, in development and in a build, externalizes an installed package
    // and Node loads its runtime dist past the transform, so the server
    // renders what the client, served through it, does not.
    ssr: { noExternal: names },
    roots: [...kits.values()].map((kit) => kit.root),
  };
}

export interface AnimusExtractOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /** The system's export name in the `system` module. The loader runs only
   *  what that export reaches, and finds it itself when exactly one export
   *  is a sealed system (`.seal()`) and every other export is plainly not
   *  one; otherwise it asks for this option by name. */
  systemExport?: string;
  /**
   * Module specifier for extracted runtime factories, default
   * `@animus-ui/system/runtime`, as every adapter emits. `@animus-ui/system`
   * also supplies every terminal; another override must supply every
   * terminal used.
   */
  runtimeImport?: string;
  /**
   * Computed `import()`s declared closed, by site: each entry names the file
   * (`importer`, relative to the root) and the function the `import()` is
   * written in. `targets: 'build-chunks'` says it loads only what the
   * build's own literal `import()`s load. The analysis records this as an
   * assumption and does not check it; every other computed `import()` may
   * still load any module.
   */
  closedDynamicImports?: ClosedDynamicImport[];
  /**
   * Substrings, or globs when `*`/`?` present. Replaces the defaults `dist`,
   * `.test.`, `.spec.`; `node_modules`, `.next`, `.animus` always apply.
   */
  exclude?: string[];
  /**
   * Replaces the default extension list entirely. `.mdx` is read for the
   * components it renders, with no MDX compiler; any reference to the
   * builder in it is an error (see the README's MDX section).
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
  /**
   * Load third-party stylesheets into `anm-vendor`, a layer below every
   * Animus layer, so their normal rules never beat Animus's. Needs
   * `@animus-ui/layergate`. `sheets` are delivered with Animus's stylesheet,
   * ahead of it; `dependencies` also covers `.css` your modules import from
   * packages; `optOut` keeps a file's own rules outside the layer. App CSS
   * and CSS Modules are left alone.
   */
  quarantine?: AnimusQuarantineOptions;
}

type AnimusExtractOptionRecord = {
  [Key in keyof AnimusExtractOptions]: AnimusExtractOptions[Key];
};

export function animusExtract(options: AnimusExtractOptions): Plugin {
  // The option type excludes 'v1', but a raw runtime value still reaches here.
  assertSupportedEngine(options.engine);
  // Warn, never throw: an extra key must not kill Vite config loading during
  // a consumer upgrade. Invalid `mode` values still throw.
  const optionRecord: AnimusExtractOptionRecord = options;
  assertKnownOptionKeys(
    optionRecord,
    ['verify', 'appearanceBootstrap', 'quarantine'],
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

  // `quarantine` puts `anm-vendor` first in the layer order Animus's own
  // stylesheet declares, whichever stylesheet the page loads first.
  const vendor = options.quarantine
    ? quarantinePlugin(options.quarantine, options.layers)
    : null;
  const ctx = new PluginContext(
    vendor ? { ...options, layers: vendor.order } : options
  );

  return {
    name: 'animus-extract',
    enforce: 'pre',

    // `__ANIMUS_DEV__` gates the system runtime's development-only diagnostics.
    async config(userConfig, env) {
      // layergate's config (a declared sheet's directory outside the root,
      // allowed for the dev server) merges with Animus's own.
      const vendorConfig = await (
        await vendor?.plugin()
      )?.config.call(this, userConfig, env);
      const withVendor = (own: UserConfig) =>
        vendorConfig ? mergeConfig(own, vendorConfig) : own;
      const { mode } = resolveMode(options.mode, () =>
        env.command === 'build' ? 'production' : 'development'
      );
      const define = { __ANIMUS_DEV__: mode === 'development' };
      const root = resolve(userConfig.root ?? process.cwd());
      const kits = await sourceKitConfig(
        root,
        resolve(root, options.system),
        ctx.kitEngine()
      );
      if (!kits) return withVendor({ define });
      const { roots, ...config } = kits;
      // Vite's watcher ignores every installed kit; these are appended to
      // the user's own ignored, and a disabled watcher stays disabled.
      const watched =
        env.command === 'serve' && userConfig.server?.watch !== null
          ? { server: { watch: { ignored: kitWatchNegations(roots) } } }
          : {};
      return withVendor({ define, ...config, ...watched });
    },

    async configureServer(server) {
      await (await vendor?.plugin())?.configureServer.call(this, server);
      ctx.devServer = server;
      // System deps can load before the server exists; workspace paths
      // outside the root get no watcher events unless registered here.
      ctx.registerSystemWatchPaths();
    },

    async configResolved(config) {
      applyResolvedConfig(ctx, config);
      (await vendor?.plugin())?.configResolved.call(this, config);
    },

    // The end of a build, and of a dev server, which Vite ends the same way:
    // the last open environment build retires the context's Session and
    // engine. buildEnd runs once per build, failed ones included; closeBundle
    // can run twice for a failed one.
    async buildEnd() {
      (await vendor?.plugin())?.buildEnd.call(this);
      if (!ctx.builds.end(this.environment ?? ctx.builds.single)) return;
      cancelSystemReload(ctx);
      ctx.close();
    },

    async buildStart() {
      await (await vendor?.plugin())?.buildStart.call(this);
      await ctx.builds.open(this.environment ?? ctx.builds.single);
      await runBuildStart(
        ctx,
        async (specifier, importer) => {
          const resolved = await this.resolve(specifier, importer);
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

    async resolveId(id, importer, resolveOptions) {
      const owned = await (
        await vendor?.plugin()
      )?.resolveId.call(this, id, importer, resolveOptions);
      if (owned) return owned;
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
      // The module it reaches must itself be kit source; an external
      // resolution stays as another resolver leaves it.
      if (
        resolved === null ||
        resolved.external ||
        !keepsKitSourceEffects(
          resolved.id.split('?')[0],
          ctx.externalPackageDirs
        )
      ) {
        return null;
      }
      return { ...resolved, moduleSideEffects: true };
    },

    async load(id) {
      const layergate = await vendor?.plugin();
      const loaded = await layergate?.load.call(this, id);
      if (loaded) return loaded;
      const own = loadVirtualModule(ctx, id);
      // Animus's stylesheet begins with the declared vendor sheets, so they
      // arrive wherever it does, whatever imports it.
      if (layergate && id === RESOLVED_CSS_ID && own !== null) {
        return (await layergate.stylesheetHead.call(this, id)) + own;
      }
      return own;
    },

    async transform(code, id) {
      // A stylesheet layergate finishes is never an Animus source; one an
      // HTML link loads in development arrives as `?direct`.
      if (vendor && /\.css(?:$|\?)/.test(id)) {
        return (await vendor.plugin()).transform.call(this, code, id);
      }
      return transformSource(ctx, code, id);
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return buildIndexHtmlTags(ctx, html);
      },
    },

    async hotUpdate(hmr) {
      // As Vite chains plugins: Animus's handler receives the modules
      // layergate settled on.
      const vendorModules = (await vendor?.plugin())?.hotUpdate.call(this, hmr);
      const next = vendorModules ? { ...hmr, modules: vendorModules } : hmr;
      return (
        (await handleHotUpdate(ctx, this.environment, next)) ?? vendorModules
      );
    },
  };
}

export default animusExtract;
