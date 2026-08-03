// ANI-004 witness: two modules each define compose families whose local
// slot recipe bindings share names (Root/Header). Slot resolution keys by
// {file}::{binding}; each family's composed CSS must namespace under ITS
// OWN module's Root class — per-file styles differ so cross-wiring would
// move bytes.
import { compose } from '@animus-ui/system/compose';

import { ds } from '../test-system';

export const Root = ds
  .styles({ display: 'flex', p: 4 })
  .variant({
    prop: 'density',
    variants: { compact: { gap: 4 }, loose: { gap: 12 } },
  })
  .asElement('div');

export const Header = ds
  .styles({ fontSize: 14 })
  .variant({
    prop: 'density',
    variants: { compact: { m: 2 }, loose: { m: 8 } },
  })
  .asElement('header');

export const FamOne = compose(
  { Root, Header },
  { name: 'FamOne', shared: { density: true } }
);
