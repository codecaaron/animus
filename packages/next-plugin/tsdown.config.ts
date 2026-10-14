import { createConfig } from '../../tsdown.config.base.ts';

export default createConfig({
  platform: 'node',
  format: ['esm', 'cjs'],
  entry: [
    './src/index.ts',
    './src/loader.ts',
    './src/turbopack-loader.ts',
    './src/font-preloads.ts',
  ],
  // The app's React, and the session's module `withAnimus` aliases.
  deps: {
    neverBundle: ['react', 'react-dom', 'virtual:animus/font-preloads'],
  },
});
