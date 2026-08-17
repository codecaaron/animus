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

// The four aliases below are exported so a consumer's `export default
// withAnimus(...)({...})` infers a type tsc can NAME via this package.
// Module-private aliases force structural expansion into `next`'s internal
// paths, which resolve to THIS package's nested `next` copy and fail the
// consumer's compile as non-portable (TS2742) whenever the app's `next`
// version differs.
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

/**
 * Wrap a Next.js config to enable Animus static CSS extraction.
 *
 * ```ts
 * // next.config.ts
 * import { withAnimus } from '@animus-ui/next-plugin';
 * export default withAnimus({ system: './src/ds.ts' })({});
 * ```
 */
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

  // Unknown top-level keys WARN naming the key (never a throw at this
  // published entry point — a consumer upgrade must not die at config load
  // over a previously-inert extra key); the listed keys are this driver's
  // own top-level surface (shared-driver-config). Invalid `mode` VALUES
  // still throw.
  //
  // `root` is named loudly rather than silently ignored, but the reason
  // differs PER ARM and neither arm reads the option:
  //   • webpack arm — Next hands the compiler `context.dir` (the project
  //     root it resolved), and that dir is the one rootDir authority (see
  //     the `context.dir` derivation in the `webpack` hook below). A
  //     consumer `root` could only disagree with it.
  //   • Turbopack arm — no Next-supplied dir is reachable. This wrapper
  //     runs during user `next.config` module evaluation, which is
  //     strictly before Next has a compiler to hand anything back:
  //     `normalizeConfig` invokes a function-form config as
  //     `(phase, { defaultConfig })` with no dir (and the function form is
  //     rejected by `NextConfigInput` anyway), and `loadConfig(phase, dir)`
  //     keeps `dir` internal. So `process.cwd()` is the only root signal
  //     that exists there — see the `rootDir` derivation in `wireTurbopack`
  //     for the known `next dev <subdir>` + Turbopack gap.
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
    // Turbopack path (default 'auto' — active under any Turbopack run):
    // the pipeline runs during config resolution (Turbopack has no compiler
    // hooks); webpack wiring is skipped for the Turbopack-active process.
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

        // Resolve paths relative to the project root Next itself resolved
        // (`next dev ./apps/web` from a monorepo root: cwd is the ROOT,
        // context.dir is the app). The compiler's `context` is set to this
        // same dir, so every config-time derivation below (sessionDir,
        // stub, aliases, watch-ignore) and the run/watchRun taps read ONE
        // root. cwd is only the fallback for harnesses that omit `dir`.
        const rootDir = context.dir?.length ? context.dir : process.cwd();

        // Inject AnimusWebpackPlugin. Constructed FIRST — the session
        // identity it claims decides the session-scoped artifact paths the
        // stub, aliases, and module replacements below point at. The root
        // is published to the session at config time so every session-path
        // derivation reads ONE root.
        const plugin = new AnimusWebpackPlugin(options);
        plugin.setRootDir(rootDir);
        const sessionDir = plugin.sessionDir;

        // Ensure the session directory and stub styles.css exist before
        // compilation. The stub file is needed for webpack module
        // resolution; processAssets replaces its content in-memory with the
        // real CSS.
        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }
        const stubCssPath = stylesPath(sessionDir);
        if (!existsSync(stubCssPath)) {
          // Derive the @layer declaration from the shared assembler so the
          // stub honors custom `layers` and never drifts from the pipeline.
          const { declaration } = assembleStylesheet({
            layers: options.layers,
            variableCss: '',
            globalCss: '',
            split: true,
          });
          writeFileSync(stubCssPath, declaration);
        }

        // One-time .gitignore check
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

        // Does this path belong to a collected external DS package dir?
        // Single definition so the loader's test/exclude can't drift
        // (shared containment predicate).
        const isExternalPackageFile = (filePath: string): boolean =>
          plugin
            .getExternalPackageDirs()
            .some((dir) => isPathWithinRoot(dir, filePath));

        config.plugins = config.plugins || [];
        config.plugins.push(plugin);

        // Supply the define the system runtime gates its development-only
        // diagnostics on, keyed on Next's dev flag — see @animus-ui/system's
        // runtime/is-dev.ts for the define/fold story. webpack arrives on the
        // hook context, so the plugin never imports it; a context without one
        // simply leaves the token absent and the runtime falls back to reading
        // NODE_ENV.
        const DefinePlugin = context.webpack?.DefinePlugin;
        if (DefinePlugin) {
          config.plugins.push(
            new DefinePlugin({
              // Emission decision: explicit `mode` wins over the compiler's
              // dev flag through the shared resolver
              // (shared-driver-config).
              __ANIMUS_DEV__: JSON.stringify(
                resolveMode(options.mode, () =>
                  context.dev === true ? 'development' : 'production'
                ).mode === 'development'
              ),
            })
          );
        }

        // Resolve alias: the transform emitter injects `import '.animus/styles.css'`
        // relative to each source file. Map it to the session-scoped
        // stylesheet (the module ID stays '.animus/styles.css'; only the
        // alias target is session-scoped).
        config.resolve = config.resolve || {};
        config.resolve.alias = config.resolve.alias || {};
        config.resolve.alias[ANIMUS_CSS_MODULE_ID] = stylesPath(sessionDir);
        // Resolve virtual:animus/* modules and external DS packages.
        // Webpack's resolve.alias doesn't handle URI schemes (virtual:),
        // so we use NormalModuleReplacementPlugin to intercept them.
        // External DS packages are redirected to src/ entries so the loader
        // processes .ts source (with builder chains) instead of .mjs dist.
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
                    // Resolve Vite-flavored CSS imports from pre-built external packages.
                    // The loader strips these, but if a file escapes loader processing
                    // (e.g., pre-compiled .mjs not matched by the rule), this fallback
                    // redirects the import to the disk-based stylesheet.
                    if (resolveData.request === 'virtual:animus/styles.css') {
                      resolveData.request = stylesPath(sessionDir);
                    }
                    // Redirect external DS packages to source entries
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

        // Inject loader rule with enforce: 'pre'. The path derivation is
        // shared with the plugin's needBuild loader-chain predicate — one
        // definition, no drift (design D1).
        const actualLoaderPath = resolveAnimusLoaderPath();

        config.module = config.module || {};
        config.module.rules = config.module.rules || [];
        config.module.rules.push({
          // File class only — the ONE owner set, shared with the Turbopack
          // rule glob and the Vite hook. `.mjs` is admitted on the class
          // alone (it used to need an external-package witness here while
          // the Turbopack arm admitted it unconditionally); module-graph
          // scoping stays in `exclude` below and the loader's manifest
          // lookup remains the file-level gate.
          test: (filePath: string) => isEngineTransformExtension(filePath),
          exclude: (filePath: string) => {
            if (!filePath.includes('node_modules')) return false;
            // Allow external DS packages through
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

/**
 * This driver's reaction to a project watcher that DIES after registration
 * (EMFILE/ENOSPC on the OS handles): a loud line on the plugin's diagnostic
 * surface. Next dev keeps serving, so silence would leave the user editing
 * source that nothing re-extracts; unlike the CLI there is no exit code to
 * spend and no degradation report to re-run, so the report is the reaction.
 * The other two claim outcomes carry no handle: `unavailable` has already
 * warned inside the orchestrator, and `already-watched` means a live
 * watcher for this root exists in this process.
 */
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

/** The session the last Turbopack config resolution published through —
 *  this process's one live publisher on that path. */
let liveTurbopackSession: ExtractionSession | null = null;

/**
 * Turbopack wiring: run the full extraction now (artifacts on disk before
 * bundling), start the dev watcher, and merge the generated rules/aliases
 * into `nextConfig.turbopack`. Consumer-managed rules for the same glob are
 * a hard error — silently stacking loaders would be undebuggable.
 */
async function wireTurbopack<Config extends NextOwnedConfig>(
  nextConfig: NextConfigInput<Config>,
  options: AnimusNextOptions
): Promise<TurbopackNextConfig<Config>> {
  // The Turbopack arm's root authority, and the reason the `root` option is
  // rejected here too (see the `rejectKeys` comment in `withAnimus`). Unlike
  // the webpack arm there is no `context.dir` to prefer: this function runs
  // during user `next.config` evaluation, and Next's config-resolution
  // contract exposes no dir to a
  // config module (`normalizeConfig` passes `(phase, {defaultConfig})`; the
  // callable form is rejected by `NextConfigInput`). Next never
  // `process.chdir`s and its dev fork inherits the launcher's cwd, so cwd
  // equals Next's `dir` for every invocation that starts in the project
  // directory. KNOWN GAP: `next dev ./apps/web` from a monorepo root leaves
  // cwd at the root while Next's dir is the app — unsupported under
  // Turbopack, and no e2e lane exercises it (every lane runs from its own
  // app directory with no dir argument). Next 16's `turbopack.root` is the
  // WORKSPACE root, semantically broader than the app dir, so adopting it
  // would widen the scan rather than fix the gap.
  const rootDir = process.cwd();

  const session = new ExtractionSession(options);
  // Next re-evaluates next.config IN-PROCESS, and this driver owns no
  // teardown hook (see the watcher comment below), so the superseded
  // resolution's session is closed here: publication ownership is
  // exclusive, and an abandoned config's claim would otherwise refuse
  // every later resolution.
  liveTurbopackSession?.close();
  liveTurbopackSession = session;
  session.rootDir = rootDir;
  // Alias parity with the webpack/vite drivers: Turbopack exposes no live
  // bundler config, so tsconfig `paths` are the alias source here.
  const aliasPairs = readTsconfigAliasPairs(rootDir);
  const builtAliases = buildPathAliasesJson(aliasPairs, rootDir);
  if (builtAliases) {
    session.pathAliasesJson = builtAliases.json;
  }
  await runSessionPipeline(session);

  // Lifecycle decision, NOT emission: whether a dev watcher runs keys on
  // the host environment only — the explicit `mode` option never disables
  // dev watching or starts watchers inside one-shot builds
  // (shared-driver-config: mode selects emission).
  if (process.env.NODE_ENV === 'development') {
    // The claim is OBSERVED, not discarded: this driver owns no teardown
    // (no process to exit, no shutdown hook), so `close()`/`settle()` have
    // no consumer here — but a watcher that dies after registration stops
    // HMR silently, and only the holder of the handle can react to that.
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
    // Session identity travels to the loader via its options — a REAL
    // Turbopack task input, so cross-session cache reuse is impossible by
    // construction and restarts are cold on first demand (design D2).
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
