import { ds } from '../../ds';

export const FireLine = ds
  .styles({
    width: '100%',
    height: '3px',
    background:
      'linear-gradient(90deg, transparent, {colors.primary}, {colors.accent}, {colors.primary}, transparent)',
    boxShadow: 'glow-fire',
  })
  .system({ space: true })
  .asElement('div');
