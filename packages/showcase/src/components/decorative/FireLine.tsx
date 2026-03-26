import { ds } from '../../ds';

export const FireLine = ds
  .styles({
    width: '100%',
    height: '3px',
    background:
      'linear-gradient(90deg, transparent, {colors.ember}, {colors.spark}, {colors.ember}, transparent)',
    boxShadow: '0 0 12px {colors.ember/40}, 0 0 40px {colors.ember/10}',
  })
  .groups({ space: true })
  .asElement('div');
