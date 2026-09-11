import { createConfig } from '../../tsdown.config.base.ts';

// Both formats ship because attw node16 requires that `require` not
// resolve to ESM; extract stays external so every driver shares one graph.
export default createConfig({
  entry: { index: './src/index.ts' },
  platform: 'node',
  format: ['esm', 'cjs'],
  deps: {
    neverBundle: ['@animus-ui/extract'],
  },
});
