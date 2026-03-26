import { ds } from '../../ds';

export const GradientBar = ds
  .styles({
    width: '60px',
    height: '2px',
    background: 'linear-gradient(90deg, {colors.scorch}, {colors.spark})',
    boxShadow: 'glow-spark',
  })
  .asElement('div');
