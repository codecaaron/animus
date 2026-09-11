import { createConfig } from '../../tsdown.config.base.ts';

export default createConfig({
  entry: {
    index: './src/index.ts',
    rollup: './src/rollup.ts',
    esbuild: './src/esbuild.ts',
    webpack: './src/webpack.ts',
    rspack: './src/rspack.ts',
  },
  platform: 'node',
  format: ['esm', 'cjs'],
  deps: {
    neverBundle: ['@animus-ui/extract', 'unplugin'],
  },
});
