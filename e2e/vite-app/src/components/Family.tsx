import { compose } from '@animus-ui/system';

import { ds } from '../ds';

const Parent = ds
  .styles({ display: 'flex', alignItems: 'center' })
  .variant({
    prop: 'density',
    variants: {
      compact: { p: 4, fontSize: 14 },
      comfortable: { p: 16, fontSize: 20 },
    },
  })
  .asElement('div');

const Descendant = ds
  .styles({ display: 'inline-flex' })
  .variant({
    prop: 'density',
    variants: {
      compact: { px: 4 },
      comfortable: { px: 8 },
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
  { Root: Parent, Child: Descendant },
  { shared: { density: true } }
);
