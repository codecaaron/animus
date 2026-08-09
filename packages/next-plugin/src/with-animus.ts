import {
  assembleStylesheet,
  buildPathAliasesJson,
  isPathWithinRoot,
  readTsconfigAliasPairs,
} from '@animus-ui/extract/pipeline';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { ExtractionSession } from './extraction-session';
import { resolveAnimusLoaderPath } from './loader-path';
import { ANIMUS_CSS_MODULE_ID, AnimusWebpackPlugin } from './plugin';
import { stylesPath, systemPropsPath } from './session-paths';
import {
  ANIMUS_TURBOPACK_RULE_GLOB,
  buildTurbopackConfig,
  resolveTurbopackLoaderPath,
  resolveTurbopackMode,
} from './turbopack-config';
import {
  runTurbopackPipeline,
  startTurbopackWatcher,
} from './turbopack-orchestrator';

import type { AnimusNextOptions } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type WebpackConfig = {
  plugins?: unknown[];
  resolve?: {
    alias?: Record<string, string>;
  };
  module?: {
    rules?: Array<{
      test?: RegExp | ((path: string) => boolean);
      exclude?: RegExp | ((path: string) => boolean);
      enforce?: string;
      use?: Array<{ loader: string; options?: Record<string, unknown> }>;
    }>;
  };
};

type NextConfig = Record<string, unknown> & {
  webpack?: (
    config: WebpackConfig,
    context: Record<string, unknown>
  ) => WebpackConfig;
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
): (nextConfig: NextConfig) => NextConfig | Promise<NextConfig> {
  if (!options.system) {
    throw new Error(
      '[animus-extract] Missing required option `system`. ' +
        'Provide the path to your SystemInstance module: withAnimus({ system: "./src/ds.ts" })'
    );
  }

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

  return (nextConfig: NextConfig): NextConfig | Promise<NextConfig> => {
    // Turbopack path (default 'auto' — active under any Turbopack run):
    // the pipeline runs during config resolution (Turbopack has no compiler
    // hooks); webpack wiring is skipped for the Turbopack-active process.
    if (resolveTurbopackMode(options)) {
      return wireTurbopack(nextConfig, options);
    }

    const existingWebpack = nextConfig.webpack;

    return {
      ...nextConfig,
      webpack(config: WebpackConfig, context: Record<string, unknown>) {
        if (typeof existingWebpack === 'function') {
          config = existingWebpack(config, context);
        }

        // Resolve paths relative to the project root Next itself resolved
        // (`next dev ./apps/web` from a monorepo root: cwd is the ROOT,
        // context.dir is the app). The compiler's `context` is set to this
        // same dir, so every config-time derivation below (sessionDir,
        // stub, aliases, watch-ignore) and the run/watchRun taps read ONE
        // root. cwd is only the fallback for harnesses that omit `dir`.
        const rootDir =
          typeof context.dir === 'string' && context.dir.length > 0
            ? context.dir
            : process.cwd();

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
        const { DefinePlugin } = (context.webpack ?? {}) as {
          DefinePlugin?: new (definitions: Record<string, string>) => unknown;
        };
        if (typeof DefinePlugin === 'function') {
          config.plugins.push(
            new DefinePlugin({
              __ANIMUS_DEV__: JSON.stringify(context.dev === true),
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
          test: (filePath: string) => {
            if (/\.[jt]sx?$/.test(filePath)) return true;
            // Allow .mjs for external DS packages (published dist with builder chains)
            return /\.mjs$/.test(filePath) && isExternalPackageFile(filePath);
          },
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
 * Turbopack wiring: run the full extraction now (artifacts on disk before
 * bundling), start the dev watcher, and merge the generated rules/aliases
 * into `nextConfig.turbopack`. Consumer-managed rules for the same glob are
 * a hard error — silently stacking loaders would be undebuggable.
 */
async function wireTurbopack(
  nextConfig: NextConfig,
  options: AnimusNextOptions
): Promise<NextConfig> {
  const rootDir = process.cwd();

  const session = new ExtractionSession(options);
  session.rootDir = rootDir;
  // Alias parity with the webpack/vite drivers: Turbopack exposes no live
  // bundler config, so tsconfig `paths` are the alias source here.
  const aliasPairs = readTsconfigAliasPairs(rootDir);
  const builtAliases = buildPathAliasesJson(aliasPairs, rootDir);
  if (builtAliases) {
    session.pathAliasesJson = builtAliases.json;
  }
  await runTurbopackPipeline(session);

  if (process.env.NODE_ENV === 'development') {
    startTurbopackWatcher(session, rootDir);
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

  const existing = (nextConfig.turbopack ?? {}) as {
    rules?: Record<string, unknown>;
    resolveAlias?: Record<string, string>;
  };
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
