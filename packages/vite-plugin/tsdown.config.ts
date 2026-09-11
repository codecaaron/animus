import { createConfig } from '../../tsdown.config.base.ts';

// A pure-ESM Vite plugin cannot pass `attw --profile node16`, which always
// reports CJSResolvesToESM; CJS also keeps declarations node16-resolvable.
export default createConfig({
  platform: 'node',
  format: ['cjs'],
  entry: ['./src/index.ts'],
});
