import { ds } from '../../../../../setup';

export const banner = ds
  .styles({
    display: 'block',
  })
  .variant({
    prop: 'density',
    defaultVariant: 'compact',
    variants: {
      compact: { padding: 4 },
      spacious: { padding: 8 },
    },
  })
  .asClass();
