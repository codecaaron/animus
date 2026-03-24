import { ds } from '../../ds';

export const VerticalBleed = ds
  .styles({
    width: '3px',
    bg: 'primary',
    boxShadow: '0 0 8px {colors.ember/30}',
  })
  .groups({ space: true, arrange: true, surface: true })
  .asElement('div');
