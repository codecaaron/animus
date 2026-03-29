import { ds } from '../../ds';

export const VerticalBleed = ds
  .styles({
    width: '3px',
    bg: 'primary',
    boxShadow: 'glow-md',
  })
  .system({ space: true, arrange: true, surface: true })
  .asElement('div');
