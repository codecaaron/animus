export { withAnimus, animusNextPlugin } from './plugin';
export type { AnimusNextPluginOptions } from './plugin';

// Export types for advanced usage
export type { AnimusTransformerOptions } from './typescript-transformer';
export { createAnimusTransformer } from './typescript-transformer';
export type { AnimusLoaderOptions } from './webpack-loader';
export type { AnimusCacheData } from './cache';

// Export utilities for advanced usage
export {
  clearAnimusCache,
  readAnimusCache,
  writeAnimusCache,
} from './cache';