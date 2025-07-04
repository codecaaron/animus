/**
 * Phase 2: Webpack Loader for Next.js
 * Transforms individual modules using metadata from Phase 1
 * Injects runtime shims with pre-calculated cascade positions
 */

import { transformAnimusCode } from '@animus-ui/core/static';
import type { LoaderContext } from 'webpack';

import { type AnimusCacheData, getMemoryCache, readAnimusCache } from './cache';

export interface AnimusLoaderOptions {
  cacheDir?: string;
  shimImportPath?: string;
  preserveDevExperience?: boolean;
  verbose?: boolean;
  useMemoryCache?: boolean;
}

/**
 * Webpack loader for transforming Animus components
 * This runs during module compilation in Next.js
 */
export default async function animusLoader(
  this: LoaderContext<AnimusLoaderOptions>,
  source: string
): Promise<string | void> {
  const callback = this.async();
  const options = this.getOptions() || {};
  const {
    cacheDir,
    shimImportPath = '@animus-ui/core/runtime',
    preserveDevExperience = process.env.NODE_ENV === 'development',
    verbose = false,
    useMemoryCache = process.env.NODE_ENV === 'development',
  } = options;

  // Quick check to see if this file needs transformation
  if (!source.includes('animus') || !source.includes('@animus-ui/core')) {
    return callback(null, source);
  }

  try {
    // Read cache data from Phase 1
    let cacheData: AnimusCacheData | null = null;

    if (useMemoryCache) {
      cacheData = getMemoryCache();
    }

    if (!cacheData) {
      cacheData = readAnimusCache(cacheDir);
    }

    if (!cacheData) {
      if (verbose) {
        this.emitWarning(
          new Error(
            '[Animus] Phase 2: No cache data found. Skipping transformation.'
          )
        );
      }
      return callback(null, source);
    }

    // Transform the code using cached metadata
    const transformed = await transformAnimusCode(source, this.resourcePath, {
      componentMetadata: cacheData.metadata,
      rootDir: cacheData.rootDir,
      generateMetadata: false, // Use pre-extracted metadata
      shimImportPath,
      injectMetadata: 'inline',
      preserveDevExperience,
    });

    if (transformed) {
      if (verbose) {
        this.emitWarning(
          new Error(`[Animus] Phase 2: Transformed ${this.resourcePath}`)
        );
      }

      // Add source map support
      if (transformed.map) {
        this.callback(null, transformed.code, transformed.map);
      } else {
        this.callback(null, transformed.code);
      }
    } else {
      // No transformation needed
      callback(null, source);
    }
  } catch (error) {
    // Log error but don't break the build
    this.emitError(error as Error);
    callback(null, source);
  }
}

/**
 * Pitch loader function to handle module resolution
 * This can be used to inject virtual modules or modify resolution
 */
export function pitch(
  this: LoaderContext<AnimusLoaderOptions>,
  remainingRequest: string
): void {
  // Currently not used, but available for future enhancements
  // such as virtual module injection or import rewriting
}
