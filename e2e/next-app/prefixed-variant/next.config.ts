import { withAnimus } from '@animus-ui/next-plugin';

// Built on its own with `next build prefixed-variant` from the parent app, so
// `root` names this directory; the app's main build and type-check exclude it.
export default withAnimus({
  system: './ds.ts',
  root: __dirname,
  prefix: 'acme',
  prefixContextualVars: true,
  strict: true,
})({});
