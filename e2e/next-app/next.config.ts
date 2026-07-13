import { withAnimus } from '@animus-ui/next-plugin';

export default withAnimus({
  verbose: true,
  system: './src/ds.ts',
  // Engine selectable per-build (extract-v2-spine row 13):
  //   ANIMUS_ENGINE=v2 vp run verify:next
  engine: process.env.ANIMUS_ENGINE === 'v2' ? 'v2' : 'v1',
})({});
