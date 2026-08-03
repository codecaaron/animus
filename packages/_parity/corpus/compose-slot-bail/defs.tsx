// ANI-004 fail-closed witness (definitions): only Root lives here. The
// composing file names a Header slot it neither defines nor imports.
import { ds } from '../test-system';

export const Root = ds
  .styles({ display: 'flex' })
  .variant({
    prop: 'density',
    variants: { compact: { gap: 4 }, loose: { gap: 12 } },
  })
  .asElement('div');
