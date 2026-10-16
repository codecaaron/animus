import {
  AnimusConfigError,
  assertKnownOptionKeys,
  assertSupportedEngine,
  isPathWithinRoot,
  keepsKitSourceEffects,
  keptDirFeatures,
  loweredDirDiagnostic,
  resolveMode,
  sourceKitDependencies,
  splitStylesheet,
  surfaceManifestDiagnostics,
  systemKitDependencies,
} from '@animus-ui/extract/pipeline';
import { resolve } from 'path';
import { mergeConfig } from 'vite';

import { runBuildStart } from './build-start';
import { bundleRemoval } from './bundle-removal';
import { applyResolvedConfig } from './config';
import {
  RESOLVED_CSS_ID,
  RESOLVED_SLICE_IDS,
  sliceStylesheetId,
} from './constants';
import { PluginContext } from './context';
import { cancelSystemReload, handleHotUpdate } from './hmr';
import {
  buildIndexHtmlTags,
  duplicatedFontPreloads,
  injectHeadTags,
  placeStylesheetSlices,
} from './index-html';
import { quarantinePlugin } from './quarantine-plugin';
import { transformSource } from './transform';
import {
  loadVirtualModule,
  resolveVirtualId,
  stylesheetSource,
} from './virtual-modules';
import { kitWatchNegations } from './watch-ignored';

import type {
  AnimusQuarantineOptions,
  ClosedDynamicImport,
  FontPreloadEntry,
  DiagnosticLevels,
  SourceKitDependency,
  StaticCssConfig,
  StylesheetDelivery,
  StylesheetSlice,
} from '@animus-ui/extract/pipeline';
import type { Environment, Plugin, Rolldown, UserConfig } from 'vite';

export { discoverFiles } from '@animus-ui/extract/pipeline';
export type {
  AnimusQuarantineOptions,
  StylesheetDelivery,
} from '@animus-ui/extract/pipeline';
/** The entries `virtual:animus/font-preloads` exports by default: each file
 *  this build preloads, the URL it is preloaded at, and its faces. */
export type {
  FontPreload,
  PreloadedFontFace,
} from '@animus-ui/extract/pipeline';

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
  /** The font faces this app preloads, in place of each typed face's own
   *  `preload` flag, so a face declared once for every product preloads only
   *  where the app renders it: family names, or `{ family, weight?, style?,
   *  unicodeRange?, fetchpriority? }` (see `FontPreloadEntry`). `[]`
   *  preloads none. */
  fontPreloads?: FontPreloadEntry[];
  /** `'split'` builds the stylesheet as three consecutive files, each page
   *  linking them in order where it would link the one sheet `'single'`
   *  (the default) builds: foundation (variables, `@property`,
   *  `anm-global`), components (base through states), then utilities
   *  (`anm-system`, `anm-custom`). In order they hold that sheet's rules,
   *  so the cascade is unchanged, and a file an edit leaves alone keeps its
   *  hash. Needs a page Vite builds from HTML to link the stylesheet; the
   *  dev server keeps one sheet. */
  stylesheets?: StylesheetDelivery;
  /** With `stylesheets: 'split'`, removes from the stylesheet's files the
   *  CSS of every component whose definition no output file includes, so it
   *  can never render; a component `staticCss` declares, and a parent of
   *  one kept, stay. A build that bundles another environment beside the
   *  client, or leaves a module external, keeps every component. Scripts a
   *  plugin emits after Animus's `generateBundle` are not seen, and a
   *  stylesheet shared with code outside the build (micro-frontends, module
   *  federation) is unsupported with this on. Off by default, and in
   *  development. */
  removeUnbundledComponents?: boolean;
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
  /** Keeps `:dir()` as written where the targets would lower it to
   *  `:lang()` over right-to-left language codes, which an element that sets
   *  only `dir` does not match. A build also excludes it from Vite's own
   *  Lightning CSS minification (`css.lightningcss.exclude`), which lowers
   *  for `build.cssTarget` across the bundle's CSS. */
  keepDirSelector?: boolean;
  /** Production names each component and utility class by a short stable
   *  id under `prefix` (a letter, then letters and digits): `{prefix}-{id}`
   *  and `{prefix}_{id}`. Each id derives from what the readable name hashes,
   *  so an added component renames no other, except in the rare case that
   *  its 32-bit id collides with one, when both take 64-bit ids. Variant,
   *  compound, state and breakpoint suffixes are kept. Development keeps the readable names.
   *  Two builds on one page take different prefixes. */
  shortClassNames?: { prefix: string };
  /** Writes `.animus/prop-order.json`, which the `animus/prop-order` lint
   *  rule reads, after every analysis; off by default. */
  propOrderFile?: boolean;
  /** Absent minifies in production only; `false` still autoprefixes. */
  minify?: boolean;
  /**
   * Emission mode. Wins over the Vite command signal, which otherwise
   * selects production for `build` and development elsewhere.
   */
  mode?: 'development' | 'production';
  /** Namespace prefix for the custom properties the theme generates: each
   *  token variable becomes `--${prefix}-…` wherever it is defined,
   *  registered or read. Contextual variables keep their declared names
   *  unless `prefixContextualVars` is set. Class names, slot classes and
   *  slot variables keep `animus-`; `shortClassNames.prefix` names classes
   *  short in production, independently of this one. */
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

/** The URL a build's root is served at, for resolving a page's hrefs: an
 *  absolute `base`, a root-relative one on a stand-in origin, or the root
 *  for a relative one, which every page resolves from its own location. */
/** Whether a hook runs for the browser's environment; a host without
 *  environments builds only that one. */
function isClient(context: { environment?: Environment }): boolean {
  return (context.environment?.config.consumer ?? 'client') === 'client';
}

function servedBase(base: string): URL {
  const origin = 'https://animus.invalid/';
  if (/^[a-z][a-z\d+.-]*:/i.test(base))
    return new URL(base.replace(/\/?$/, '/'));
  if (base.startsWith('/')) return new URL(base.replace(/\/?$/, '/'), origin);
  return new URL(origin);
}

export function animusExtract(options: AnimusExtractOptions): Plugin {
  // The option type excludes 'v1', but a raw runtime value still reaches here.
  assertSupportedEngine(options.engine);
  // Warn, never throw: an extra key must not kill Vite config loading during
  // a consumer upgrade. Invalid `mode` values still throw.
  const optionRecord: AnimusExtractOptionRecord = options;
  assertKnownOptionKeys(
    optionRecord,
    [
      'verify',
      'appearanceBootstrap',
      'quarantine',
      'removeUnbundledComponents',
    ],
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
  // Only `true` removes: any other value keeps every component's CSS.
  const removes = options.removeUnbundledComponents === true;
  if (removes && options.stylesheets !== 'split') {
    throw new AnimusConfigError(
      "removeUnbundledComponents needs stylesheets: 'split': it removes CSS from the stylesheet's own files, which only a split build emits after its scripts."
    );
  }

  // `quarantine` puts `anm-vendor` first in the layer order Animus's own
  // stylesheet declares, whichever stylesheet the page loads first.
  const vendor = options.quarantine
    ? quarantinePlugin(options.quarantine, options.layers)
    : null;
  const ctx = new PluginContext(
    vendor ? { ...options, layers: vendor.order } : options
  );

  /** The stylesheet with the declared vendor sheets at its head, so they
   *  arrive wherever it does, whatever imports it. */
  async function withVendorHead(
    context: Rolldown.PluginContext,
    sheet: string
  ): Promise<string> {
    const layergate = await vendor?.plugin();
    return layergate
      ? (await layergate.stylesheetHead.call(context, RESOLVED_CSS_ID)) + sheet
      : sheet;
  }

  // Every environment a build of the whole app builds beside the client,
  // whose output may render what the client's does not.
  let otherEnvironments: string[] = [];
  // The manifests this build writes, where removal relinks a replaced slice.
  let manifests = new Set<string>();

  // A split client build's slices, cut once in `buildStart`, and the ids of
  // those it emitted, in link order.
  let slices = new Map<StylesheetSlice, string>();
  let linkedSlices: string[] = [];

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
      // Vite's CSS minification lowers for build.cssTarget on its own.
      const keptDir: UserConfig = options.keepDirSelector
        ? {
            css: {
              lightningcss: keptDirFeatures(userConfig.css?.lightningcss),
            },
          }
        : {};
      const root = resolve(userConfig.root ?? process.cwd());
      const kits = await sourceKitConfig(
        root,
        resolve(root, options.system),
        ctx.kitEngine()
      );
      if (!kits) return withVendor({ define, ...keptDir });
      const { roots, ...config } = kits;
      // Vite's watcher ignores every installed kit; these are appended to
      // the user's own ignored, and a disabled watcher stays disabled.
      const watched =
        env.command === 'serve' && userConfig.server?.watch !== null
          ? { server: { watch: { ignored: kitWatchNegations(roots) } } }
          : {};
      return withVendor({ define, ...config, ...watched, ...keptDir });
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
      otherEnvironments = config.builder
        ? Object.keys(config.environments).filter((name) => name !== 'client')
        : [];
      const { manifest, ssrManifest } = config.build;
      manifests = new Set([
        ...(manifest === true
          ? ['.vite/manifest.json']
          : manifest
            ? [manifest]
            : []),
        ...(ssrManifest === true
          ? ['.vite/ssr-manifest.json']
          : ssrManifest
            ? [ssrManifest]
            : []),
      ]);
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
      // Each client build reports a :dir() its minification lowers once.
      if (isClient(this)) {
        ctx.servedDirSelector = false;
        ctx.warnedLoweredDir = false;
      }
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
      // Each slice an entry of its own: Vite runs it through its CSS
      // pipeline (asset URLs, base, minify) into a content-hashed file.
      if (ctx.splitsStylesheet && isClient(this)) {
        const sheet = await withVendorHead(this, stylesheetSource(ctx));
        const cut = splitStylesheet(sheet);
        slices = new Map(cut.map(({ slice, css }) => [slice, css]));
        linkedSlices = [];
        for (const { slice, css } of cut) {
          if (css === '') continue;
          const id = sliceStylesheetId(slice);
          this.emitFile({ type: 'chunk', id, name: `animus-${slice}` });
          linkedSlices.push(id);
        }
      }
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
      const slice = RESOLVED_SLICE_IDS.get(id);
      if (slice !== undefined) return slices.get(slice) ?? '';
      const own = loadVirtualModule(ctx, id);
      // A split build's foundation slice carries the vendor sheets.
      if (id === RESOLVED_CSS_ID && own !== null && !ctx.splitsStylesheet) {
        return withVendorHead(this, own);
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

    // After Vite's build-html plugin has applied every index.html hook, so
    // a preload another plugin adds after Animus's is in the HTML it reads.
    generateBundle: {
      order: 'post',
      handler(_output, bundle) {
        const emitAsset = (name: string, source: string) =>
          this.getFileName(this.emitFile({ type: 'asset', name, source }));
        if (linkedSlices.length > 0 && isClient(this)) {
          const removal = removes
            ? bundleRemoval(ctx, bundle, linkedSlices, {
                otherEnvironments,
                manifests,
                emit: (asset) => this.emitFile(asset),
              })
            : null;
          placeStylesheetSlices(
            ctx,
            bundle,
            linkedSlices,
            emitAsset,
            removal ? (file) => removal.replace(file) : undefined
          );
          removal?.finish();
        }
        if (ctx.servedDirSelector && !ctx.warnedLoweredDir && isClient(this)) {
          const sheets = Object.values(bundle).flatMap((file) =>
            file.type === 'asset' && file.fileName.endsWith('.css')
              ? [file.source]
              : []
          );
          if (
            sheets.length > 0 &&
            sheets.every(
              (source) =>
                !Buffer.from(source).toString('utf8').includes(':dir(')
            )
          ) {
            ctx.warnedLoweredDir = true;
            surfaceManifestDiagnostics(
              {
                diagnostics: [
                  loweredDirDiagnostic(
                    "Vite's CSS minification",
                    'build.cssTarget'
                  ),
                ],
              },
              (message) => ctx.warn(message),
              {
                levels: ctx.options.diagnostics,
                strict: ctx.options.strict,
                reportErrors: ctx.reportErrors(),
              }
            );
          }
        }
        if (!ctx.served?.fontPreloads.length) return;
        for (const file of Object.values(bundle)) {
          if (file.type !== 'asset' || !file.fileName.endsWith('.html')) {
            continue;
          }
          const html = Buffer.from(file.source).toString('utf8');
          if (!html.includes('data-animus-preload')) continue;
          for (const href of duplicatedFontPreloads(
            html,
            new URL(file.fileName, servedBase(ctx.base)).href
          )) {
            ctx.warn(
              `[animus-extract] ${file.fileName} preloads ${href} twice: Animus's font preload and another preload tag, written in the page or added by a plugin whose index.html hook runs after Animus's, so the browser may fetch it twice. Remove the other preload; Animus's names the URL the stylesheet's url() loads.`
            );
          }
        }
      },
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return injectHeadTags(html, buildIndexHtmlTags(ctx, html));
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
