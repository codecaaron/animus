import { ds } from '../../ds';

export const GradientBar = ds
  .styles({
    width: '60px',
    height: '2px',
    background: 'linear-gradient(90deg, {colors.primary}, {colors.accent})',
    boxShadow: 'glow-accent',
  })
  .asElement('div');
