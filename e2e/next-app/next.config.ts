import { withAnimus } from '@animus-ui/next-plugin';

export default withAnimus({
  verbose: true,
  system: './src/ds.ts',
})({
  // Required for TS-only syntax in external DS package SOURCE files
  // (ani-015-root-issues inc 06): the kit entry exports an `as const`
  // variant map, and the animus webpack loader passes componentless files
  // through unchanged (next-webpack-integration › "Files with no extractable
  // components SHALL pass through unchanged") — without SWC transpilation of
  // the workspace package, webpack's ES parser rejects the raw TS. The
  // animus loader still runs `enforce: 'pre'`, so it sees original source
  // before SWC either way. Turbopack (next16-app) needs no equivalent.
  transpilePackages: ['@animus-ui/test-ds'],
});
