import { compose } from '@animus-ui/system';

import { ds } from '../ds';

const Root = ds
  .styles({ display: 'flex', alignItems: 'center' })
  .variant({
    prop: 'size',
    variants: {
      small: { p: 4, fontSize: 14 },
      large: { p: 16, fontSize: 20 },
    },
  })
  .asElement('div');

const Child = ds
  .styles({ display: 'inline-flex' })
  .variant({
    prop: 'size',
    variants: {
      small: { px: 4 },
      large: { px: 8 },
    },
  })
  .variant({
    prop: 'intent',
    variants: {
      primary: { bg: 'primary', color: 'background' },
      secondary: { bg: 'secondary', color: 'background' },
    },
  })
  .asElement('span');

export const Family = compose(
  { root: Root, child: Child },
  { shared: { size: true } }
);
