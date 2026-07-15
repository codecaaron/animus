import { withAnimus } from '@animus-ui/next-plugin';

export default withAnimus({
  verbose: true,
  system: './src/ds.ts',
  // Escape hatch (extract-v2-default-flip): ANIMUS_ENGINE=v1 vp run verify:next
  engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
})({});
