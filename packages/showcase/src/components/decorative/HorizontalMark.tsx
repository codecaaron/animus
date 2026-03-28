import { ds } from '../../ds';

export const HorizontalMark = ds
  .styles({
    height: '3px',
    bg: 'primary',
    boxShadow: 'glow-md',
  })
  .groups({ space: true, arrange: true })
  .asElement('div');
