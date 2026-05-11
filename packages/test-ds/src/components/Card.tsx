import { ds } from '../system';

export const Card = ds
  .styles({
    bg: 'surface',
    p: 16,
    borderRadius: '8px',
    color: 'text',
  })
  .system({ m: true, mx: true, my: true })
  .asElement('div');
