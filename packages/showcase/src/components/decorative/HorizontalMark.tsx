import { ds } from '../../ds';

export const HorizontalMark = ds
  .styles({
    height: '3px',
    bg: 'primary',
    boxShadow: '0 0 12px {colors.ember/50}',
  })
  .groups({ space: true, arrange: true })
  .asElement('div');
