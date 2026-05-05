import { createConfig } from '../../tsdown.config.base.ts';

export default createConfig({
  entry: ['./pipeline/index.ts'],
  platform: 'node',
  outputExtension: () => ({ js: '.mjs', dts: '.d.mts' }),
  deps: {
    neverBundle: ['@animus-ui/extract'],
  },
});
