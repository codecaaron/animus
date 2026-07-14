import { createConfig } from '../../tsdown.config.base.ts';

export default createConfig({
  platform: 'node',
  outExtensions: () => ({ js: '.js' }),
});
