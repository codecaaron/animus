import { ds } from '../test-system';

export const Button = ds
  .styles({ display: 'inline-flex', gap: 4 })
  .variant({
    prop: 'tone',
    variants: {
      quiet: { fontWeight: 400 },
      loud: { fontWeight: 700 },
    },
  })
  .asElement('button');
