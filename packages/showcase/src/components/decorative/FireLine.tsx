import { ds } from '../../ds';

export const FireLine = ds
  .styles({
    width: '100%',
    height: '3px',
    background:
      'linear-gradient(90deg, transparent, {colors.ember}, {colors.spark}, {colors.ember}, transparent)',
    boxShadow: 'glow-fire',
  })
  .groups({ space: true })
  .asElement('div');
