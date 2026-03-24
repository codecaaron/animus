import { ds } from '../../ds';

export const GoldDash = ds
  .styles({
    width: '12px',
    height: '3px',
    bg: 'accent',
    flexShrink: 0,
  })
  .asElement('div');
