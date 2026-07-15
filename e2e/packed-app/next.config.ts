import { withAnimus } from '@animus-ui/next-plugin';

export default withAnimus({
  system: './src/ds.ts',
  // No `engine` key: the packed consumer exercises the shipped default.
})({});
