import { size } from '@animus-ui/system';

import { ds } from '../ds';

export const Card = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 8,
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    boxShadow: 'md',
    p: 16,
  })
  .variant({
    prop: 'elevation',
    variants: {
      flat: { boxShadow: 'sm' },
      raised: { boxShadow: 'md' },
      floating: { boxShadow: 'lg' },
    },
  })
  .props({
    sizing: {
      property: 'flexBasis',
      transform: size,
    } as const,
  })
  .asElement('div');
