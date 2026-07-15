import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

import { AnimusWebpackPlugin } from './plugin';

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
): (nextConfig: NextConfig) => NextConfig {
  if (!options.system) {
    throw new Error(
      '[animus-extract] Missing required option `system`. ' +
        'Provide the path to your SystemInstance module: withAnimus({ system: "./src/ds.ts" })'
    );
  }

  return (nextConfig: NextConfig): NextConfig => {
    const existingWebpack = nextConfig.webpack;

    return {
      ...nextConfig,
      webpack(config: WebpackConfig, context: Record<string, unknown>) {
        // Resolve paths relative to project root
        const rootDir = process.cwd();

        // Ensure .animus/ directory and stub styles.css exist before compilation.
        // The stub file is needed for webpack module resolution; processAssets
        // replaces its content in-memory with the real CSS.
        const animusDir = join(rootDir, '.animus');
        if (!existsSync(animusDir)) {
          mkdirSync(animusDir, { recursive: true });
        }
        const stubCssPath = join(animusDir, 'styles.css');
        if (!existsSync(stubCssPath)) {
          writeFileSync(
            stubCssPath,
            '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;\n'
          );
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

        // Inject AnimusWebpackPlugin
        const plugin = new AnimusWebpackPlugin({
          system: options.system,
          exclude: options.exclude,
          strict: options.strict,
          verbose: options.verbose,
          prefix: options.prefix,
          engine: options.engine,
        });

        config.plugins = config.plugins || [];
        config.plugins.push(plugin);

        // Resolve alias: the transform emitter injects `import '.animus/styles.css'`
        // relative to each source file. Map it to the absolute path at project root.
        config.resolve = config.resolve || {};
        config.resolve.alias = config.resolve.alias || {};
        config.resolve.alias['.animus/styles.css'] = join(
          rootDir,
          '.animus',
          'styles.css'
        );
        // Resolve virtual:animus/* modules and external DS packages.
        // Webpack's resolve.alias doesn't handle URI schemes (virtual:),
        // so we use NormalModuleReplacementPlugin to intercept them.
        // External DS packages are redirected to src/ entries so the loader
        // processes .ts source (with builder chains) instead of .mjs dist.
        const systemPropsPath = join(rootDir, '.animus', 'system-props.js');
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
                      resolveData.request = systemPropsPath;
                    }
                    // Resolve Vite-flavored CSS imports from pre-built external packages.
                    // The loader strips these, but if a file escapes loader processing
                    // (e.g., pre-compiled .mjs not matched by the rule), this fallback
                    // redirects the import to the disk-based stylesheet.
                    if (resolveData.request === 'virtual:animus/styles.css') {
                      resolveData.request = join(
                        rootDir,
                        '.animus',
                        'styles.css'
                      );
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

        // Inject loader rule with enforce: 'pre'
        const loaderPath = resolve(__dirname, 'loader.mjs');
        // Fallback: if running from source (dev), use the source path
        const actualLoaderPath = existsSync(loaderPath)
          ? loaderPath
          : resolve(__dirname, 'loader.ts');

        config.module = config.module || {};
        config.module.rules = config.module.rules || [];
        config.module.rules.push({
          test: (filePath: string) => {
            if (/\.[jt]sx?$/.test(filePath)) return true;
            // Allow .mjs for external DS packages (published dist with builder chains)
            if (/\.mjs$/.test(filePath)) {
              const pkgDirs = plugin.getExternalPackageDirs();
              return pkgDirs.some(
                (dir) => filePath.startsWith(dir + sep) || filePath === dir
              );
            }
            return false;
          },
          exclude: (filePath: string) => {
            if (!filePath.includes('node_modules')) return false;
            // Allow external DS packages through
            const pkgDirs = plugin.getExternalPackageDirs();
            return !pkgDirs.some(
              (dir) => filePath.startsWith(dir + sep) || filePath === dir
            );
          },
          enforce: 'pre',
          use: [
            {
              loader: actualLoaderPath,
              options: { strict: options.strict },
            },
          ],
        });

        // Compose with existing webpack function if present
        if (typeof existingWebpack === 'function') {
          return existingWebpack(config, context);
        }

        return config;
      },
    };
  };
}
