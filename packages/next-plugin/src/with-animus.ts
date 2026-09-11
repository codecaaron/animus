import {
  assembleStylesheet,
  assertKnownOptionKeys,
  buildPathAliasesJson,
  isEngineTransformExtension,
  isPathWithinRoot,
  readTsconfigAliasPairs,
  resolveMode,
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
  resolveTurbopackMode,
} from './turbopack-config';

import type { AnimusNextOptions } from './types';
import type { TurbopackWatchOutcome } from '@animus-ui/extract/session';
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

export type TurbopackNextConfig<Config extends NextOwnedConfig> = Omit<
  Config,
  'turbopack'
> & {
  turbopack: TurbopackOptions;
};

let warnedGitignore = false;
let warnedUnstableTurbopack = false;

export function withAnimus(
  options: AnimusNextOptions
): <Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>
) => WebpackNextConfig<Config> | Promise<TurbopackNextConfig<Config>> {
  if (!options.system) {
    throw new Error(
      '[animus-extract] Missing required option `system`. ' +
        'Provide the path to your SystemInstance module: withAnimus({ system: "./src/ds.ts" })'
    );
  }

  assertKnownOptionKeys(
    { ...options },
    ['cssImportTarget', 'turbopack', 'unstable_turbopack', 'loaderPath'],
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
    nextConfig: NextConfigInput<Config>
  ): WebpackNextConfig<Config> | Promise<TurbopackNextConfig<Config>> => {
    if (resolveTurbopackMode(options)) {
      return wireTurbopack(nextConfig, options);
    }

    const existingWebpack = nextConfig.webpack;

    return {
      ...nextConfig,
      webpack(config: WebpackConfig, context: NextWebpackContext) {
        if (existingWebpack) {
          config = existingWebpack(config, context);
        }

        const rootDir = context.dir?.length ? context.dir : process.cwd();

        const plugin = new AnimusWebpackPlugin(options);
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
              __ANIMUS_DEV__: JSON.stringify(
                resolveMode(options.mode, () =>
                  context.dev === true ? 'development' : 'production'
                ).mode === 'development'
              ),
            })
          );
        }

        config.resolve = config.resolve || {};
        config.resolve.alias = config.resolve.alias || {};
        config.resolve.alias[ANIMUS_CSS_MODULE_ID] = stylesPath(sessionDir);
        // `resolve.alias` does not handle URI schemes, so `virtual:` requests
        // are rewritten here; external packages redirect to source entries.
        const sessionSystemPropsPath = systemPropsPath(sessionDir);
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
                          fn: (resolveData: { request: string }) => void
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
                    if (resolveData.request === 'virtual:animus/styles.css') {
                      resolveData.request = stylesPath(sessionDir);
                    }
                    const entries = plugin.getExternalSourceEntries();
                    const srcEntry = entries.get(resolveData.request);
                    if (srcEntry) {
                      resolveData.request = srcEntry;
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

let liveTurbopackSession: ExtractionSession | null = null;

async function wireTurbopack<Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>,
  options: AnimusNextOptions
): Promise<TurbopackNextConfig<Config>> {
  const rootDir = process.cwd();

  const session = new ExtractionSession(options);
  liveTurbopackSession?.close();
  liveTurbopackSession = session;
  session.rootDir = rootDir;
  const aliasPairs = readTsconfigAliasPairs(rootDir);
  const builtAliases = buildPathAliasesJson(aliasPairs, rootDir);
  if (builtAliases) {
    session.pathAliasesJson = builtAliases.json;
  }
  await runSessionPipeline(session);

  if (process.env.NODE_ENV === 'development') {
    bindTurbopackWatchDeathReport(
      startTurbopackWatcher(session, rootDir),
      rootDir
    );
  }

  const fragment = buildTurbopackConfig({
    rootDir,
    loaderPath: resolveTurbopackLoaderPath(__dirname),
    options,
    externalSourceEntries: session.externalSourceEntries,
    sessionId: session.sessionId,
    sessionDir: session.sessionDir,
  });

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
