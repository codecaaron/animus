import { withAnimus } from '@animus-ui/next-plugin';

// Built on its own with `next build prefixed-variant`; the app's main build
// and type-check exclude this directory.
export default withAnimus({
  system: './ds.ts',
  prefix: 'acme',
  prefixContextualVars: true,
  strict: true,
})({});
