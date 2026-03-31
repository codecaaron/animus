import { createConfig } from '../../tsdown.config.base';

export default createConfig({
  platform: 'node',
  entry: ['./src/index.ts', './src/loader.ts'],
});
