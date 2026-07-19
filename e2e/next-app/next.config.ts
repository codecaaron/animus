import { withAnimus } from '@animus-ui/next-plugin';

export default withAnimus({
  verbose: true,
  system: './src/ds.ts',
  // Escape hatch: ANIMUS_ENGINE=v1 vp run @animus-ui/next-app#verify
  engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
})({});
