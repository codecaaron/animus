import { ds } from './ds';

export const Card = ds
  .styles({
    bg: 'tone',
    '--tone': 'red',
    '--edge': 'var(--cap, var(--tone))',
    transition: '--tone 1s',
  })
  .props({ capSize: { property: '--cap', scale: 'sizes', strict: false } })
  .asElement('div');
