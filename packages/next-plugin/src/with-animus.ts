import {
  assembleStylesheet,
  assertKnownOptionKeys,
  buildPathAliasesJson,
  isEngineTransformExtension,
  isPathWithinRoot,
  readTsconfigAliasPairs,
  resolveMode,
  sourceKitDependencies,
} from '@animus-ui/extract/pipeline';
import {
  ExtractionSession,
  runSessionPipeline,
  startTurbopackWatcher,
  stylesPath,
  systemPropsPath,
} from '@animus-ui/extract/session';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { resolveAnimusLoaderPath } from './loader-path';
import { ANIMUS_CSS_MODULE_ID, AnimusWebpackPlugin } from './plugin';
import {
  ANIMUS_TURBOPACK_RULE_GLOB,
  buildTurbopackConfig,
  resolveTurbopackLoaderPath,
  isTurbopackDevelopment,
  resolveTurbopackMode,
} from './turbopack-config';

import type { TurbopackConfigFragment } from './turbopack-config';
import type { AnimusNextOptions } from './types';
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

export function withAnimus(
  options: AnimusNextOptions
): <Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>
) => WebpackNextConfig<Config> | TurbopackNextConfig<Config> {
  if (!options.system) {
    throw new Error(
      '[animus-extract] Missing required option `system`. ' +
        'Provide the path to your SystemInstance module: withAnimus({ system: "./src/ds.ts" })'
    );
  }

  // Unknown top-level keys warn rather than throw, so a consumer upgrade
  // cannot die at config load; invalid `mode` values still throw. `root` is
  // refused rather than honored: each arm derives its own dir below, and a
  // consumer root can only contradict it.
  assertKnownOptionKeys(
    { ...options },
    [
      'cssImportTarget',
      'turbopack',
      'unstable_turbopack',
      'loaderPath',
      'phase',
    ],
    [
      {
        key: 'root',
        reason:
          "this driver derives its own root — Next's `dir` under webpack, " +
          '`process.cwd()` under Turbopack (Next passes no dir to a config module)',
      },
    ],
    {
      onUnknownKey: 'warn',
      warn: (message) => console.warn(`[animus-extract] ${message}`),
    }
  );

  if (
    options.unstable_turbopack &&
    !options.turbopack &&
    !warnedUnstableTurbopack
  ) {
    warnedUnstableTurbopack = true;
    console.warn(
      '[animus-extract] `unstable_turbopack` is deprecated — rename it to `turbopack` (same shape)'
    );
  }

  return <Config extends NextOwnedConfig>(
    authoredConfig: NextConfigInput<Config>
  ): WebpackNextConfig<Config> | TurbopackNextConfig<Config> => {
    const nextConfig = withSourceKits(authoredConfig, process.cwd());
    if (resolveTurbopackMode(options)) {
      return turbopackConfig(nextConfig, options);
    }

    const existingWebpack = nextConfig.webpack;

    return {
      ...nextConfig,
      webpack(config: WebpackConfig, context: NextWebpackContext) {
        if (existingWebpack) {
          config = existingWebpack(config, context);
        }

        const rootDir = context.dir?.length ? context.dir : process.cwd();

        // The session takes the host's mode, so `next dev`'s first full pass
        // keeps unrendered CSS like every later dev pass.
        const { mode } = resolveMode(options.mode, () =>
          context.dev === true ? 'development' : 'production'
        );
        const plugin = new AnimusWebpackPlugin(
          { ...options, mode },
          { development: context.dev === true }
        );
        plugin.setRootDir(rootDir);
        const sessionDir = plugin.sessionDir;

        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }
        const stubCssPath = stylesPath(sessionDir);
        if (!existsSync(stubCssPath)) {
          const { declaration } = assembleStylesheet({
            layers: options.layers,
            variableCss: '',
            globalCss: '',
            split: true,
          });
          writeFileSync(stubCssPath, declaration);
        }

        if (!warnedGitignore) {
          warnedGitignore = true;
          try {
            const gitignorePath = join(rootDir, '.gitignore');
            if (existsSync(gitignorePath)) {
              const content = readFileSync(gitignorePath, 'utf-8');
              if (!content.includes('.animus')) {
                console.warn(
                  '[animus-extract] Add `.animus/` to your .gitignore — it contains generated build artifacts.'
                );
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
                // of the entry it replaces is set as a rule's would be.
                nmf.hooks.afterResolve.tap(
                  'AnimusVirtualResolve',
                  (resolveData) => {
                    const sideEffects = redirectSideEffects.get(resolveData);
                    const settings = resolveData.createData?.settings;
                    if (sideEffects !== undefined && settings) {
                      settings.sideEffects = sideEffects;
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
                strict: options.strict,
                development: context.dev === true,
                cssImportTarget: options.cssImportTarget,
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
  createData?: { settings?: { sideEffects?: boolean } };
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

/** The config with the source kits the app depends on added to
 *  `transpilePackages`. The kit redirect points both bundles at a kit's
 *  source, but Next's server keeps an installed package external, and so
 *  loads its runtime entry, unless the package is transpiled; transpiling
 *  also compiles its TypeScript source. */
function withSourceKits<Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>,
  rootDir: string
): NextConfigInput<Config> {
  const declared = nextConfig.transpilePackages ?? [];
  const kits = sourceKitDependencies(rootDir)
    .map((kit) => kit.name)
    .filter((name) => !declared.includes(name));
  if (kits.length === 0) return nextConfig;
  return { ...nextConfig, transpilePackages: [...declared, ...kits] };
}

function turbopackConfig<Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>,
  options: AnimusNextOptions
): TurbopackNextConfig<Config> {
  const load = (phase: string): Promise<TurbopackNextConfigObject<Config>> =>
    loadTurbopackFragment(options, phase).then((fragment) =>
      mergeTurbopackFragment(nextConfig, fragment)
    );
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

let liveTurbopackSession: ExtractionSession | null = null;
let liveTurbopackWatcher: TurbopackWatcherHandle | null = null;
/** The load the live session came from. Next loads the config again after
 *  Ready (validateTurboNextConfig), and a user config may await this one
 *  besides: the same phase and root share one analysis and keep the watcher.
 *  A rejected load is dropped, so a repaired source loads again. */
let liveTurbopackLoad: {
  key: string;
  fragment: Promise<TurbopackConfigFragment>;
} | null = null;

function loadTurbopackFragment(
  options: AnimusNextOptions,
  phase: string
): Promise<TurbopackConfigFragment> {
  // `next dev <subdir>` under Turbopack is a known gap: no dir reaches a
  // config module, so cwd is the only root signal. Next 16's `turbopack.root`
  // is the workspace root, broader than the app dir, so adopting it widens
  // the scan instead of closing the gap.
  const rootDir = process.cwd();
  const key = JSON.stringify([phase, rootDir]);
  if (liveTurbopackLoad?.key === key) return liveTurbopackLoad.fragment;
  const fragment = analyzeForTurbopack(options, phase, rootDir);
  const load = { key, fragment };
  liveTurbopackLoad = load;
  fragment.catch(() => {
    if (liveTurbopackLoad === load) liveTurbopackLoad = null;
  });
  return fragment;
}

async function analyzeForTurbopack(
  options: AnimusNextOptions,
  phase: string,
  rootDir: string
): Promise<TurbopackConfigFragment> {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  const { mode } = resolveMode(options.mode, () =>
    development ? 'development' : 'production'
  );
  // Turbopack leaves an `import(expr)` it cannot read unbundled.
  const session = new ExtractionSession(
    { ...options, mode },
    { unbundledComputedImports: true }
  );
  // A replaced session's watcher would keep the root claimed for it.
  liveTurbopackSession?.close();
  liveTurbopackWatcher?.close();
  liveTurbopackWatcher = null;
  liveTurbopackSession = session;
  // The dev server's phase, not the emission mode: an error-level
  // diagnostic reports there and the session keeps publishing.
  session.development = development;
  session.rootDir = rootDir;
  const aliasPairs = readTsconfigAliasPairs(rootDir);
  const builtAliases = buildPathAliasesJson(aliasPairs, rootDir);
  if (builtAliases) {
    session.pathAliasesJson = builtAliases.json;
  }
  await runSessionPipeline(session);

  // A load that started while this one analyzed has replaced its session.
  if (development && liveTurbopackSession === session) {
    const outcome = startTurbopackWatcher(session, rootDir);
    bindTurbopackWatchDeathReport(outcome, rootDir);
    if (outcome.kind === 'started') liveTurbopackWatcher = outcome.handle;
  }

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
