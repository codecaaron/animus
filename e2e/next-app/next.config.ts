import { withAnimus } from '@animus-ui/next-plugin';

export default withAnimus({
  verbose: true,
  system: './src/ds.ts',
})({
  // Without SWC transpilation of this workspace package, webpack's ES parser
  // rejects its raw TS source. The animus loader still sees original source.
  transpilePackages: ['@animus-ui/test-ds'],
});
