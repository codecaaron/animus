import { createConfig } from '../../tsdown.config.base.ts';

// Dual output for the `./pipeline` subpath. The published entry is the CJS
// `dist/index.cjs` (exports map points there): the previous `.mjs`-only output
// masqueraded as CJS under node16 (types are CJS-flavored `.d.ts` from tsgo,
// runtime was ESM) and pointed `require` at an `.mjs`; the CJS entry makes types
// and runtime agree and clears attw. The `.mjs` is still emitted because
// `packages/extract/tests/canary.test.ts` requires `../dist/index.mjs` directly
// by path (outside this increment's footprint). `@mdx-js/mdx` is consumed via
// dynamic `import()`, which works unchanged from either format.
export default createConfig({
  entry: ['./pipeline/index.ts'],
  platform: 'node',
  format: ['esm', 'cjs'],
  deps: {
    neverBundle: ['@animus-ui/extract'],
  },
});
