import { createConfig } from '../../tsdown.config.base.ts';

// CJS output. A pure-ESM Vite plugin cannot pass `attw --profile node16`
// (node16-from-CJS always reports the blocking CJSResolvesToESM). As a
// build-time Node tool, CJS is idiomatic: `vite.config.ts` ESM imports interop
// with the statically-analyzable named exports, and the plugin's own engine
// loading already uses `require()`. CJS also keeps the tsgo-emitted
// declarations resolvable under node16.
export default createConfig({
  platform: 'node',
  format: ['cjs'],
  entry: ['./src/index.ts'],
});
