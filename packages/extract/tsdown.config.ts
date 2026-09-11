import { createConfig } from '../../tsdown.config.base.ts';

export default createConfig({
  // One build for both entries so a stateful pipeline module (engine-adapter's
  // store) has a single runtime instance across the two subpaths.
  entry: { index: './pipeline/index.ts', session: './session/index.ts' },
  platform: 'node',
  format: ['esm', 'cjs'],
  deps: {
    neverBundle: ['@animus-ui/extract'],
  },
});
