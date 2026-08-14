import { createConfig } from '../../tsdown.config.base.ts';

// Dual-format host package: per-bundler subpath entries beside the root.
// The exports map serves CJS (attw node16: require must not resolve to
// ESM — the extract/cli package shape). The extraction machinery and
// unplugin stay external so the host, the plugins, and the session share
// one runtime module graph.
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
