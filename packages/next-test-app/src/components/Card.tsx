import { size } from '@animus-ui/system';

import { ds } from '../ds';

export const Card = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '8px',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
  })
  .props({
    sizing: {
      property: 'flexBasis',
      transform: size,
    } as const,
  })
  .asElement('div');
