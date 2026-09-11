// A sibling module defines slots with the same binding names; resolution keys
// by file and binding, so neither family may pick up the other's styles.
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
