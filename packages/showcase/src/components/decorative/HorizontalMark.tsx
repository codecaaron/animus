import { ds } from '../../ds';

export const HorizontalMark = ds
  .styles({
    height: '3px',
    bg: 'primary',
    boxShadow: 'glow-md',
  })
  .system({ space: true, arrange: true })
  .asElement('div');
