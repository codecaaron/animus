import { ds } from '../ds';

export const Card = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    p: 16,
  })
  .asElement('div');
