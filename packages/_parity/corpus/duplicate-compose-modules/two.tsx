// ANI-004 witness (module two): identical local binding names, different
// styles — see one.tsx.
import { compose } from '@animus-ui/system/compose';

import { ds } from '../test-system';

export const Root = ds
  .styles({ display: 'grid', p: 8 })
  .variant({
    prop: 'density',
    variants: { compact: { gap: 2 }, loose: { gap: 16 } },
  })
  .asElement('div');

export const Header = ds
  .styles({ fontSize: 18 })
  .variant({
    prop: 'density',
    variants: { compact: { m: 1 }, loose: { m: 6 } },
  })
  .asElement('header');

export const FamTwo = compose(
  { Root, Header },
  { name: 'FamTwo', shared: { density: true } }
);
