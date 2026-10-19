import {
  AnimusConfigError,
  ARTIFACTS_NOT_IGNORED,
  assembleStylesheet,
  assertSupportedEngine,
  assertKnownOptionKeys,
  fontPreloadsModule,
  hostFinding,
  isEngineTransformExtension,
  isPathWithinRoot,
  keepsKitSourceEffects,
  LOWERED_DIR_SELECTOR,
  nextImageAssetClassification,
  OPTION_DEPRECATED,
  OPTION_UNSUPPORTED,
  outputExclusion,
  resolveMode,
  sourceKitDependencies,
  surfaceManifestDiagnostics,
  TURBOPACK_CWD_ROOT,
  turbopackExtensionPolicy,
  withVendorLayer,
} from '@animus-ui/extract/pipeline';
import {
  createBuildId,
  ExtractionSession,
  FONT_PRELOADS_MODULE_ID,
  fontPreloadsPath,
  requireEngine,
  runSessionPipeline,
  startTurbopackWatcher,
  stylesPath,
  systemPropsPath,
} from '@animus-ui/extract/session';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { resolveAnimusLoaderPath } from './loader-path';
import { ANIMUS_CSS_MODULE_ID, AnimusWebpackPlugin } from './plugin';
import { QUARANTINE_TURBOPACK_MESSAGE, quarantinePlugin } from './quarantine';
import { sameDirectory } from './same-directory';
import {
  ANIMUS_TURBOPACK_RULE_GLOB,
  buildTurbopackConfig,
  resolveTurbopackLoaderPath,
  isTurbopackDevelopment,
  resolveTurbopackMode,
  turbopackSideEffectsLimits,
} from './turbopack-config';

import type { TurbopackConfigFragment } from './turbopack-config';
import type { AnimusNextOptions } from './types';
import type { WatchOptions } from './watch-ignored';
import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';
import type {
  TurbopackWatcherHandle,
  TurbopackWatchOutcome,
} from '@animus-ui/extract/session';
import type {
  NextConfig as NextOwnedConfig,
  TurbopackOptions,
} from 'next/dist/server/config-shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type WebpackPluginEntry = object | false | null | undefined;

interface WebpackLoaderUse {
  loader: string;
  options?: object | string;
}

interface WebpackRule {
  test?: RegExp | ((path: string) => boolean);
  exclude?: RegExp | ((path: string) => boolean);
  enforce?: string;
  use?: WebpackLoaderUse[];
}

interface WebpackConfig {
  plugins?: WebpackPluginEntry[];
  /** Next's watcher reads these, not the compiler's normalized copy. */
  watchOptions?: WatchOptions;
  resolve?: {
    alias?: Record<string, string>;
  };
  module?: {
    rules?: WebpackRule[];
  };
}

type DefinePluginConstructor = new (
  definitions: Record<string, string>
) => object;

interface NextWebpackContext {
  dir?: string;
  dev?: boolean;
  isServer?: boolean;
  webpack?: {
    DefinePlugin?: DefinePluginConstructor;
  };
}

type NextWebpackHook = (
  config: WebpackConfig,
  context: NextWebpackContext
) => WebpackConfig;

interface NextConfigBoundary {
  webpack?: NextWebpackHook | null;
  turbopack?: TurbopackOptions;
  /** The legacy home of Turbopack's options, which Next still merges into
   *  `turbopack` for a config written before the key moved, and the
   *  Lightning CSS pass's switches. */
  experimental?: {
    turbo?: { resolveExtensions?: string[] };
    useLightningcss?: boolean;
    lightningCssFeatures?: { include?: string[]; exclude?: string[] };
  };
}

type CallableNextConfig = (
  ...args: never[]
) => NextOwnedConfig | Promise<NextOwnedConfig>;

// Exported so a consumer's inferred config type stays nameable: private
// aliases expand into this package's nested `next` copy and fail with TS2742.
export type { NextConfigBoundary as AnimusNextConfigBoundary };

export type NextConfigInput<Config extends NextOwnedConfig> =
  Config extends CallableNextConfig ? never : Config & NextConfigBoundary;

export type WebpackNextConfig<Config extends NextOwnedConfig> = Omit<
  Config,
  'webpack'
> & {
  webpack: NextWebpackHook;
};

export type TurbopackNextConfigObject<Config extends NextOwnedConfig> = Omit<
  Config,
  'turbopack'
> & {
  turbopack: TurbopackOptions;
};

/** Next calls a function config with its phase, the one signal that tells
 *  `next dev` from `next build` while the config loads: `NODE_ENV` can be
 *  set either way, and `NEXT_PHASE` is set only after compiling. A config
 *  that wraps this one awaits it instead, and it then resolves in the
 *  `phase` option's phase, or by `NODE_ENV` without one. */
export type TurbopackNextConfig<Config extends NextOwnedConfig> = ((
  phase: string
) => Promise<TurbopackNextConfigObject<Config>>) &
  PromiseLike<TurbopackNextConfigObject<Config>>;

/** `PHASE_DEVELOPMENT_SERVER` and `PHASE_PRODUCTION_BUILD` in
 *  `next/constants`. */
const PHASE_DEVELOPMENT_SERVER = 'phase-development-server';
const PHASE_PRODUCTION_BUILD = 'phase-production-build';

let warnedGitignore = false;
let warnedUnstableTurbopack = false;
let warnedLoweredDir = false;

export function withAnimus(
  options: AnimusNextOptions
): <Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>
) => WebpackNextConfig<Config> | TurbopackNextConfig<Config> {
  // Before anything loads the native module (SA2).
  assertSupportedEngine(options.engine);
  if (!options.system) {
    throw new Error(
      '[animus-extract] Missing required option `system`. ' +
        'Provide the path to your SystemInstance module: withAnimus({ system: "./src/ds.ts" })'
    );
  }

  // Unknown top-level keys warn rather than throw, so a consumer upgrade
  // cannot die at config load; invalid `mode` values still throw.
  assertKnownOptionKeys(
    { ...options },
    [
      'cssImportTarget',
      'turbopack',
      'unstable_turbopack',
      'loaderPath',
      'phase',
      'quarantine',
    ],
    [],
    {
      onUnknownKey: 'warn',
      warn: (message) => console.warn(`[animus-extract] ${message}`),
    }
  );

  // Next decides its own CSS chunks and their order, so it links one
  // sheet, as Vite's dev server does: the output is the same cascade.
  if ('stylesheets' in options && options.stylesheets === 'split') {
    reportFindings(options, [
      hostFinding(
        OPTION_UNSUPPORTED,
        'withAnimus',
        'stylesheets',
        "'split' is not supported by the Next plugin yet: Next decides how CSS chunks are merged and ordered, so it links one stylesheet"
      ),
    ]);
  }

  if (
    options.unstable_turbopack &&
    !options.turbopack &&
    !warnedUnstableTurbopack
  ) {
    warnedUnstableTurbopack = true;
    reportFindings(options, [
      hostFinding(
        OPTION_DEPRECATED,
        'withAnimus',
        'unstable_turbopack',
        'is deprecated — rename it to `turbopack` (same shape)'
      ),
    ]);
  }

  // One build per config load: every compiler, the loaders and the
  // Turbopack workers take part in it, and another `next` process of the
  // same root is another build.
  const build = createBuildId();

  // The app's root: the one authority for its source kits and both arms'
  // sessions. Next passes no dir to a config module, so without `root` it
  // is the cwd, which webpack checks against Next's dir below.
  const appRoot =
    options.root === undefined ? process.cwd() : resolve(options.root);

  return <Config extends NextOwnedConfig>(
    authoredConfig: NextConfigInput<Config>
  ): WebpackNextConfig<Config> | TurbopackNextConfig<Config> => {
    const turbopack = resolveTurbopackMode(options);
    const nextConfig = withKeptDirSelector(
      withTranspiled(authoredConfig, transpiledPackages(appRoot)),
      options,
      turbopack || 'TURBOPACK' in process.env,
      appRoot
    );
    // Refused whenever Turbopack runs, whatever Animus's own mode: Next
    // then never calls the webpack hook, so vendor CSS would ship
    // unlayered. Next sets TURBOPACK, possibly empty, so its presence
    // counts.
    if (options.quarantine && (turbopack || 'TURBOPACK' in process.env)) {
      throw new AnimusConfigError(QUARANTINE_TURBOPACK_MESSAGE);
    }
    if (turbopack) {
      warnTurbopackCwdRoot(options, appRoot);
      return turbopackConfig(nextConfig, options, build, appRoot);
    }

    const existingWebpack = nextConfig.webpack;

    return {
      ...nextConfig,
      webpack(config: WebpackConfig, context: NextWebpackContext) {
        if (existingWebpack) {
          config = existingWebpack(config, context);
        }

        // Next's dir is the app webpack builds: the kits were read from
        // `appRoot`, so a disagreement fails rather than build with another
        // app's kits.
        if (context.dir?.length && !sameDirectory(context.dir, appRoot)) {
          throw new AnimusConfigError(
            `[animus-extract] Next builds ${context.dir}, but Animus read the ` +
              `app's source kits from ${appRoot}. Run next from the app ` +
              `directory, or pass withAnimus({ root }) naming it.`
          );
        }
        const rootDir = appRoot;

        // The session takes the host's mode, so `next dev`'s first full pass
        // keeps unrendered CSS like every later dev pass.
        const { mode } = resolveMode(options.mode, () =>
          context.dev === true ? 'development' : 'production'
        );
        // `quarantine` puts `anm-vendor` first in the layer order Animus's
        // stylesheet declares.
        const vendorOrder = options.quarantine
          ? withVendorLayer(options.layers)
          : undefined;
        const layers = vendorOrder ?? options.layers;
        const plugin = new AnimusWebpackPlugin(
          { ...options, layers, mode },
          { development: context.dev === true, build }
        );
        plugin.setRootDir(rootDir);
        if (nextConfig.distDir) {
          plugin.excludeOutputDir(resolve(rootDir, nextConfig.distDir));
        }
        const sessionDir = plugin.sessionDir;

        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }
        const stubCssPath = stylesPath(sessionDir);
        if (!existsSync(stubCssPath)) {
          const { declaration } = assembleStylesheet({
            layers,
            variableCss: '',
            globalCss: '',
            split: true,
          });
          writeFileSync(stubCssPath, declaration);
        }
        // Resolvable before the first publication writes it.
        const sessionFontPreloadsPath = fontPreloadsPath(sessionDir);
        if (!existsSync(sessionFontPreloadsPath)) {
          writeFileSync(sessionFontPreloadsPath, fontPreloadsModule([]));
        }

        if (!warnedGitignore) {
          warnedGitignore = true;
          try {
            const gitignorePath = join(rootDir, '.gitignore');
            if (existsSync(gitignorePath)) {
              const content = readFileSync(gitignorePath, 'utf-8');
              if (!content.includes('.animus')) {
                reportFindings(options, [
                  hostFinding(
                    ARTIFACTS_NOT_IGNORED,
                    '.gitignore',
                    '.animus/',
                    'is not ignored, and it holds generated build artifacts — add `.animus/` to .gitignore'
                  ),
                ]);
              }
            }
          } catch {}
        }

        const isExternalPackageFile = (filePath: string): boolean =>
          plugin
            .getExternalPackageDirs()
            .some((dir) => isPathWithinRoot(dir, filePath));

        config.plugins = config.plugins || [];
        config.plugins.push(plugin);
        // Next's watcher reads this config's watch options, not the
        // compiler's: the plugin rewrites them once webpack has validated
        // the config, whose schema takes no matcher.
        plugin.watchConfig(config);

        // Only the client compiler builds stylesheets. Animus's stylesheet
        // delivers the declared sheets, and Animus's watch matcher watches
        // what layergate reads.
        if (options.quarantine && vendorOrder && context.isServer !== true) {
          const gate = quarantinePlugin(
            options.quarantine,
            vendorOrder,
            stubCssPath
          );
          config.plugins.push(gate);
          plugin.watchAlso((path) => gate.watches(path));
        }

        const DefinePlugin = context.webpack?.DefinePlugin;
        if (DefinePlugin) {
          config.plugins.push(
            new DefinePlugin({
              __ANIMUS_DEV__: JSON.stringify(mode === 'development'),
            })
          );
        }

        config.resolve = config.resolve || {};
        config.resolve.alias = config.resolve.alias || {};
        config.resolve.alias[ANIMUS_CSS_MODULE_ID] = stylesPath(sessionDir);
        // `resolve.alias` does not handle URI schemes, so `virtual:` requests
        // are rewritten here; external packages redirect to source entries.
        // The stylesheet id is rewritten too: a persistent resolve cache keys
        // a request without its alias target, so the alias alone resolves to
        // an earlier build's session stylesheet. The alias stays for resolves
        // that bypass the module factory.
        const sessionSystemPropsPath = systemPropsPath(sessionDir);
        const redirectSideEffects = new WeakMap<KitResolveData, boolean>();
        config.plugins.push({
          apply(compiler: {
            hooks: {
              normalModuleFactory: {
                tap: (
                  name: string,
                  fn: (nmf: {
                    hooks: {
                      beforeResolve: {
                        tap: (
                          name: string,
                          fn: (resolveData: KitResolveData) => void
                        ) => void;
                      };
                      afterResolve: {
                        tap: (
                          name: string,
                          fn: (resolveData: KitResolveData) => void
                        ) => void;
                      };
                    };
                  }) => void
                ) => void;
              };
            };
          }) {
            compiler.hooks.normalModuleFactory.tap(
              'AnimusVirtualResolve',
              (nmf) => {
                nmf.hooks.beforeResolve.tap(
                  'AnimusVirtualResolve',
                  (resolveData) => {
                    if (resolveData.request === 'virtual:animus/system-props') {
                      resolveData.request = sessionSystemPropsPath;
                    }
                    if (resolveData.request === FONT_PRELOADS_MODULE_ID) {
                      resolveData.request = sessionFontPreloadsPath;
                    }
                    if (
                      resolveData.request === 'virtual:animus/styles.css' ||
                      resolveData.request === ANIMUS_CSS_MODULE_ID
                    ) {
                      resolveData.request = stylesPath(sessionDir);
                    }
                    const entries = plugin.getExternalSourceEntries();
                    const srcEntry = entries.get(resolveData.request);
                    if (srcEntry) {
                      const sideEffects = plugin
                        .getExternalSourceSideEffects()
                        .get(resolveData.request);
                      if (sideEffects !== undefined) {
                        redirectSideEffects.set(resolveData, sideEffects);
                      }
                      resolveData.request = srcEntry;
                    }
                  }
                );
                // Webpack would classify the source entry by its own path
                // against the package's `sideEffects`, so the classification
                // of the entry it replaces is set as a rule's would be. A
                // kit's other source modules stay side-effectful when that
                // reading could drop a listed effect.
                nmf.hooks.afterResolve.tap(
                  'AnimusVirtualResolve',
                  (resolveData) => {
                    const issuer = resolveData.contextInfo?.issuer;
                    const resolved = resolveData.createData?.resource;
                    if (issuer && resolved !== undefined) {
                      // A redirected request is pinned to the instance read;
                      // another resolves with its importer's rule options.
                      plugin.reportHostResolution(
                        issuer,
                        resolveData.request,
                        resolved
                      );
                    }
                    const sideEffects = redirectSideEffects.get(resolveData);
                    const settings = resolveData.createData?.settings;
                    if (!settings) return;
                    if (sideEffects !== undefined) {
                      settings.sideEffects = sideEffects;
                      return;
                    }
                    const resource = resolveData.createData?.resource;
                    if (
                      resource !== undefined &&
                      keepsKitSourceEffects(
                        resource,
                        plugin.getExternalPackageDirs()
                      )
                    ) {
                      settings.sideEffects = true;
                    }
                  }
                );
              }
            );
          },
        });

        const actualLoaderPath = resolveAnimusLoaderPath();

        config.module = config.module || {};
        config.module.rules = config.module.rules || [];
        config.module.rules.push({
          test: (filePath: string) => isEngineTransformExtension(filePath),
          exclude: (filePath: string) => {
            if (!filePath.includes('node_modules')) return false;
            return !isExternalPackageFile(filePath);
          },
          enforce: 'pre',
          use: [
            {
              loader: actualLoaderPath,
              options: {
                development: context.dev === true,
                cssImportTarget: options.cssImportTarget,
                build,
                root: rootDir,
              },
            },
          ],
        });

        return config;
      },
    };
  };
}

/** The part of webpack's resolve data the kit redirect reads and writes. */
interface KitResolveData {
  request: string;
  contextInfo?: { issuer?: string };
  createData?: { resource?: string; settings?: { sideEffects?: boolean } };
}

export function bindTurbopackWatchDeathReport(
  outcome: TurbopackWatchOutcome,
  rootDir: string
): void {
  if (outcome.kind !== 'started') return;
  const handle = outcome.handle;
  handle.onDied = () => {
    console.error(
      `[animus-extract] dev watcher for ${rootDir} died — source edits are ` +
        'no longer extracted; restart the dev server'
    );
  };
}

const NEXT_PLUGIN_PACKAGE = '@animus-ui/next-plugin';

let warnedTurbopackCwd = false;

/** Reports the plugin's own findings under the `diagnostics` levels. */
function reportFindings(
  options: AnimusNextOptions,
  diagnostics: ManifestDiagnostic[]
): void {
  surfaceManifestDiagnostics(
    { diagnostics },
    (line) => console.warn(`[animus-extract] ${line}`),
    { levels: options.diagnostics, strict: options.strict }
  );
}

/** Turbopack's loaders get no app dir either, so a cwd that is not the app
 *  cannot be detected later: warn at startup when the cwd holds no Next
 *  config and no `root` names the app. */
function warnTurbopackCwdRoot(
  options: AnimusNextOptions,
  appRoot: string
): void {
  if (options.root !== undefined || warnedTurbopackCwd) return;
  const hasNextConfig = ['js', 'mjs', 'cjs', 'ts', 'mts'].some((ext) =>
    existsSync(join(appRoot, `next.config.${ext}`))
  );
  if (hasNextConfig) return;
  warnedTurbopackCwd = true;
  reportFindings(options, [
    hostFinding(
      TURBOPACK_CWD_ROOT,
      appRoot,
      'turbopack',
      'the current directory holds no next.config: under Turbopack, Animus ' +
        'reads the app from the current directory. Run next from the app ' +
        'directory, or pass withAnimus({ root }) naming it.'
    ),
  ]);
}

/** The config with `packages` added to `transpilePackages`. Next's server
 *  keeps an installed package external, and so loads its runtime entry,
 *  unless the package is transpiled. */
function withTranspiled<Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>,
  packages: readonly string[]
): NextConfigInput<Config> {
  const declared = nextConfig.transpilePackages ?? [];
  const added = packages.filter((name) => !declared.includes(name));
  if (added.length === 0) return nextConfig;
  return { ...nextConfig, transpilePackages: [...declared, ...added] };
}

/**
 * The config with Next's own Lightning CSS pass told to keep `:dir()`, as
 * `keepDirSelector` keeps it in Animus's sheet: that pass, Turbopack's and
 * webpack's under `experimental.useLightningcss`, lowers it again for the
 * app's browserslist. The caller's other features stay. A Next whose
 * `experimental.lightningCssFeatures` cannot name the feature is told, when
 * its pass runs, rather than given a key it rejects.
 */
function withKeptDirSelector<Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>,
  options: AnimusNextOptions,
  turbopack: boolean,
  appRoot: string
): NextConfigInput<Config> {
  if (options.keepDirSelector !== true) return nextConfig;
  const experimental = nextConfig.experimental ?? {};
  if (!nextNamesLightningCssFeature(appRoot, DIR_SELECTOR)) {
    if ((turbopack || experimental.useLightningcss) && !warnedLoweredDir) {
      warnedLoweredDir = true;
      reportFindings(options, [
        hostFinding(
          LOWERED_DIR_SELECTOR,
          'next.config',
          'keepDirSelector',
          "keeps :dir() in Animus's stylesheet, but this Next has no experimental.lightningCssFeatures to keep it in its own Lightning CSS pass, which lowers it to :lang() for the app's browserslist: an element that sets only dir does not match. Upgrade Next, or raise the browserslist to browsers that support :dir() (Chrome 120, Firefox 49, Safari 16.4)."
        ),
      ]);
    }
    return nextConfig;
  }
  const features = experimental.lightningCssFeatures ?? {};
  const exclude = features.exclude ?? [];
  if (exclude.includes(DIR_SELECTOR)) return nextConfig;
  return {
    ...nextConfig,
    experimental: {
      ...experimental,
      lightningCssFeatures: {
        ...features,
        exclude: [...exclude, DIR_SELECTOR],
      },
    },
  };
}

/** Next's name for the Lightning CSS feature that lowers `:dir()`. */
const DIR_SELECTOR = 'dir-selector';

/** Whether the app's Next takes `feature` in
 *  `experimental.lightningCssFeatures`: its config module lists the names. */
function nextNamesLightningCssFeature(
  appRoot: string,
  feature: string
): boolean {
  try {
    const shared: { LIGHTNINGCSS_FEATURE_NAMES?: unknown } = createRequire(
      join(appRoot, 'package.json')
    )('next/dist/server/config-shared');
    const names = shared.LIGHTNINGCSS_FEATURE_NAMES;
    return Array.isArray(names) && names.includes(feature);
  } catch {
    return false;
  }
}

/** The packages Next must transpile: the source kits the app depends on,
 *  since the kit redirect points both bundles at a kit's TypeScript source,
 *  and this package, whose font-preloads entry imports the session module
 *  only the bundle's alias resolves. */
function transpiledPackages(rootDir: string): string[] {
  // The native module answers the kit source table directly; the build's
  // session engine is not created at config time.
  return [
    ...sourceKitDependencies(rootDir, requireEngine()).map((kit) => kit.name),
    NEXT_PLUGIN_PACKAGE,
  ];
}

function turbopackConfig<Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>,
  options: AnimusNextOptions,
  build: string,
  appRoot: string
): TurbopackNextConfig<Config> {
  // Turbopack's extension order as Next merges it: `turbopack`, else the
  // legacy `experimental.turbo`; its documented default without either.
  const resolveExtensions =
    nextConfig.turbopack?.resolveExtensions ??
    nextConfig.experimental?.turbo?.resolveExtensions;
  const outputExclude = nextConfig.distDir
    ? outputExclusion(appRoot, resolve(appRoot, nextConfig.distDir))
    : null;
  const load = (phase: string): Promise<TurbopackNextConfigObject<Config>> =>
    loadTurbopackFragment(
      options,
      phase,
      resolveExtensions,
      outputExclude,
      nextConfig.images?.disableStaticImages === true,
      build,
      appRoot
    ).then((fragment) => mergeTurbopackFragment(nextConfig, fragment));
  function then<Resolved = TurbopackNextConfigObject<Config>, Rejected = never>(
    onResolved?:
      | ((
          config: TurbopackNextConfigObject<Config>
        ) => Resolved | PromiseLike<Resolved>)
      | null,
    onRejected?:
      | (<Thrown>(reason: Thrown) => Rejected | PromiseLike<Rejected>)
      | null
  ): Promise<Resolved | Rejected> {
    const phase =
      options.phase ??
      (isTurbopackDevelopment()
        ? PHASE_DEVELOPMENT_SERVER
        : PHASE_PRODUCTION_BUILD);
    return load(phase).then(onResolved, onRejected);
  }
  const config = Object.assign(load, { then });
  // A wrapper that copies this config's keys into an object would otherwise
  // copy `then`, and Next would await Animus's config in place of its own.
  Object.defineProperty(config, 'then', { enumerable: false });
  return config;
}

/** One config wrapper's live Turbopack session, its watcher, and the load
 *  it came from. Next loads the config again after Ready
 *  (validateTurboNextConfig), and a user config may await this one besides:
 *  the same phase and root share one analysis and keep the watcher. A
 *  rejected load is dropped, so a repaired source loads again. */
interface TurbopackOwner {
  session: ExtractionSession | null;
  watcher: TurbopackWatcherHandle | null;
  load: { key: string; fragment: Promise<TurbopackConfigFragment> } | null;
}

/** Each wrapper's owner, by the build it created: another wrapper of the
 *  same root is another build and never shares or closes this one's. */
const turbopackOwners = new Map<string, TurbopackOwner>();

function turbopackOwner(build: string): TurbopackOwner {
  let owner = turbopackOwners.get(build);
  if (owner === undefined) {
    owner = { session: null, watcher: null, load: null };
    turbopackOwners.set(build, owner);
  }
  return owner;
}

function loadTurbopackFragment(
  options: AnimusNextOptions,
  phase: string,
  resolveExtensions: readonly string[] | undefined,
  outputExclude: string | null,
  disableStaticImages: boolean,
  build: string,
  rootDir: string
): Promise<TurbopackConfigFragment> {
  // The extension order is part of the analysis a load shares.
  const key = JSON.stringify([
    phase,
    rootDir,
    resolveExtensions ?? null,
    disableStaticImages,
  ]);
  const owner = turbopackOwner(build);
  if (owner.load?.key === key) return owner.load.fragment;
  const fragment = analyzeForTurbopack(
    options,
    phase,
    rootDir,
    resolveExtensions,
    outputExclude,
    disableStaticImages,
    build
  );
  const load = { key, fragment };
  owner.load = load;
  fragment.catch(() => {
    if (owner.load === load) owner.load = null;
  });
  return fragment;
}

async function analyzeForTurbopack(
  options: AnimusNextOptions,
  phase: string,
  rootDir: string,
  resolveExtensions: readonly string[] | undefined,
  outputExclude: string | null,
  disableStaticImages: boolean,
  build: string
): Promise<TurbopackConfigFragment> {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  const { mode } = resolveMode(options.mode, () =>
    development ? 'development' : 'production'
  );
  // Turbopack leaves an `import(expr)` it cannot read unbundled.
  // Each phase Next loads the config in is a host operation of its own,
  // with its own mode, so it is a build of its own.
  const session = new ExtractionSession(
    { ...options, mode },
    { unbundledComputedImports: true, build: `${build}-${phase}` }
  );
  session.writesFontPreloadsModule = true;
  // A replaced session's watcher would keep the root claimed for it.
  const owner = turbopackOwner(build);
  owner.session?.close();
  owner.watcher?.close();
  owner.watcher = null;
  owner.session = session;
  // The dev server's phase, not the emission mode: an error-level
  // diagnostic reports there and the session keeps publishing.
  session.development = development;
  session.rootDir = rootDir;
  if (outputExclude !== null) session.structuralExclude = [outputExclude];
  session.extensionPolicy = turbopackExtensionPolicy(resolveExtensions);
  session.assetClassification = nextImageAssetClassification(
    rootDir,
    disableStaticImages
  );
  // Each full pass re-reads the tsconfig aliases.
  session.aliasesFromTsconfig = true;
  // Under next dev the watcher starts before the first pass and holds what
  // it sees until that pass publishes, so an edit made while it runs is
  // analyzed after it rather than lost.
  if (development) {
    const outcome = startTurbopackWatcher(session, rootDir, {
      holdEvents: true,
    });
    bindTurbopackWatchDeathReport(outcome, rootDir);
    if (outcome.kind === 'started') owner.watcher = outcome.handle;
  }
  const watcher = owner.watcher;
  try {
    await runSessionPipeline(session);
  } catch (err) {
    if (owner.watcher === watcher) {
      watcher?.close();
      owner.watcher = null;
    }
    throw err;
  }

  // A load that started while this one analyzed has replaced its session,
  // and closed this watcher.
  if (owner.session === session) void watcher?.deliverHeldEvents();

  reportFindings(
    options,
    turbopackSideEffectsLimits(
      rootDir,
      session.externalSourceEntries,
      session.externalSourceSideEffects
    )
  );

  return buildTurbopackConfig({
    rootDir,
    loaderPath: resolveTurbopackLoaderPath(__dirname),
    options,
    externalSourceEntries: session.externalSourceEntries,
    sessionId: session.sessionId,
    sessionDir: session.sessionDir,
    development,
  });
}

function mergeTurbopackFragment<Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>,
  fragment: TurbopackConfigFragment
): TurbopackNextConfigObject<Config> {
  const existing: TurbopackOptions = nextConfig.turbopack ?? {};
  if (existing.rules && ANIMUS_TURBOPACK_RULE_GLOB in existing.rules) {
    throw new Error(
      `[animus-extract] turbopack.rules['${ANIMUS_TURBOPACK_RULE_GLOB}'] is already configured — remove the consumer rule or disable unstable_turbopack`
    );
  }

  return {
    ...nextConfig,
    turbopack: {
      ...existing,
      rules: { ...existing.rules, ...fragment.rules },
      resolveAlias: { ...existing.resolveAlias, ...fragment.resolveAlias },
    },
  };
}
