import { createConfig } from '../../tsdown.config.base';

export default createConfig({
  platform: 'node',
  format: ['esm', 'cjs'],
  entry: ['./src/index.ts', './src/loader.ts'],
});
