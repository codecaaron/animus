/**
 * Next.js Plugin for Animus Static Extraction
 * Two-phase architecture: TypeScript transformer + Webpack loader
 */

import * as path from 'path';

import type { NextConfig } from 'next';
import type { Configuration as WebpackConfig } from 'webpack';

import {
  type AnimusTransformerOptions,
  createAnimusTransformer,
} from './typescript-transformer';
import type { AnimusLoaderOptions } from './webpack-loader';

export interface AnimusNextPluginOptions {
  theme?: string | any;
  output?: string;
  themeMode?: 'inline' | 'css-variable' | 'hybrid';
  atomic?: boolean;
  cacheDir?: string;
  verbose?: boolean;
  shimImportPath?: string;
  preserveDevExperience?: boolean;
}

/**
 * Webpack plugin for emitting CSS and metadata
 */
class AnimusWebpackPlugin {
  constructor(private options: AnimusNextPluginOptions) {}

  apply(compiler: any) {
    const { output = 'animus.css', cacheDir, verbose } = this.options;

    compiler.hooks.emit.tapAsync(
      'AnimusWebpackPlugin',
      (compilation: any, callback: any) => {
        try {
          // Read cache to get CSS
          const { readAnimusCache } = require('./cache');
          const cacheData = readAnimusCache(cacheDir);

          if (cacheData && cacheData.css) {
            // Emit CSS file
            compilation.assets[output] = {
              source: () => cacheData.css,
              size: () => cacheData.css.length,
            };

            // Emit metadata file
            const metadataFileName = output.replace(/\.css$/, '.metadata.json');
            const metadataContent = JSON.stringify(cacheData.metadata, null, 2);

            compilation.assets[metadataFileName] = {
              source: () => metadataContent,
              size: () => metadataContent.length,
            };

            if (verbose) {
              console.log(
                `[Animus] Generated ${(cacheData.css.length / 1024).toFixed(2)}KB of CSS`
              );
              console.log(
                `[Animus] Generated metadata for ${Object.keys(cacheData.metadata).length} components`
              );
            }
          } else if (verbose) {
            console.warn('[Animus] No cache data found for CSS generation');
          }
        } catch (error) {
          console.error('[Animus] Failed to emit CSS:', error);
        }

        callback();
      }
    );
  }
}

/**
 * Load theme from file
 */
async function loadTheme(themePath: string): Promise<any> {
  const fullPath = path.resolve(process.cwd(), themePath);

  try {
    // Clear require cache for hot reloading
    delete require.cache[require.resolve(fullPath)];

    // For TypeScript themes, they should be pre-compiled
    const theme = require(fullPath);
    return theme.default || theme.theme || theme;
  } catch (error) {
    throw new Error(`Failed to load theme from ${themePath}: ${error}`);
  }
}

/**
 * Main plugin function that modifies Next.js config
 */
export function withAnimus(options: AnimusNextPluginOptions = {}) {
  return async (nextConfig: NextConfig = {}): Promise<NextConfig> => {
    const {
      theme: themePath,
      themeMode = 'hybrid',
      atomic = true,
      cacheDir,
      verbose = false,
      shimImportPath = '@animus-ui/core/runtime',
      preserveDevExperience = true,
    } = options;
    
    // Ensure output has a default value for webpack plugin
    const optionsWithDefaults = {
      ...options,
      output: options.output || 'animus.css'
    };

    // Load theme if provided
    let theme: any;
    if (themePath) {
      if (typeof themePath === 'string') {
        theme = await loadTheme(themePath);
      } else {
        theme = themePath;
      }
    }

    return {
      ...nextConfig,

      // Phase 1: TypeScript Transformer
      typescript: {
        ...nextConfig.typescript,
        customTransformers: {
          before: [
            ...((nextConfig.typescript as any)?.customTransformers?.before || []),
            createAnimusTransformer({
              rootDir: process.cwd(),
              cacheDir,
              theme,
              themeMode,
              atomic,
              verbose,
            } as AnimusTransformerOptions),
          ],
          after: (nextConfig.typescript as any)?.customTransformers?.after,
          afterDeclarations:
            (nextConfig.typescript as any)?.customTransformers?.afterDeclarations,
        },
      } as any,

      // Phase 2: Webpack Configuration
      webpack: (config: WebpackConfig, context: any) => {
        // Run user's webpack config first
        if (nextConfig.webpack) {
          config = nextConfig.webpack(config, context);
        }

        const { dev, isServer } = context;

        // Add webpack loader (pre-enforce to run before babel)
        config.module = config.module || {};
        config.module.rules = config.module.rules || [];

        config.module.rules.unshift({
          test: /\.(tsx?|jsx?)$/,
          exclude: /node_modules/,
          enforce: 'pre',
          use: [
            {
              loader: require.resolve('./webpack-loader'),
              options: {
                cacheDir,
                shimImportPath,
                preserveDevExperience: preserveDevExperience && dev,
                verbose,
                useMemoryCache: dev,
              } as AnimusLoaderOptions,
            },
          ],
        });

        // Add webpack plugin for CSS emission (client-side only)
        if (!isServer && !dev) {
          config.plugins = config.plugins || [];
          config.plugins.push(new AnimusWebpackPlugin(optionsWithDefaults));
        }

        return config;
      },
    };
  };
}

/**
 * Alternative API for direct next.config.js usage
 */
export function animusNextPlugin(options: AnimusNextPluginOptions = {}) {
  return withAnimus(options);
}