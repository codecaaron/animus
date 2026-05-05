import { createConfig } from '../../tsdown.config.base.ts';

export default createConfig({
  platform: 'node',
  format: ['esm', 'cjs'],
  entry: ['./src/index.ts', './src/loader.ts'],
});
