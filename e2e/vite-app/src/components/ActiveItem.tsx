import { ds } from '../ds';

export const ActiveItem = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    px: 8,
    py: 4,
    borderRadius: '4px',
    bg: 'surface',
    color: 'text',
    '[data-active="true"] &': {
      bg: 'primary',
      color: 'background',
    },
    '& + &': { ml: 8 },
  })
  .asElement('span');
