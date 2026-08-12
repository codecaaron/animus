import { createConfig } from '../../tsdown.config.base.ts';

// Dual-format Node CLI: the bin shim dynamic-imports dist/index.mjs;
// the exports map serves CJS (attw node16: require must not resolve to
// ESM — same shape as the extract pipeline subpath). The
// extraction machinery stays external (workspace dependency) so the CLI,
// the plugins, and the session share one runtime module graph.
export default createConfig({
  entry: { index: './src/index.ts' },
  platform: 'node',
  format: ['esm', 'cjs'],
  deps: {
    neverBundle: ['@animus-ui/extract'],
  },
});
