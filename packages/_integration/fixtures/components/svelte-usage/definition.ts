import { ds } from '../../setup';

export const badge = ds
  .styles({
    display: 'inline-flex',
  })
  .variant({
    prop: 'tone',
    defaultVariant: 'quiet',
    variants: {
      quiet: { color: 'primary' },
      loud: { color: 'secondary' },
      urgent: { color: 'text' },
    },
  })
  .props({
    gap: {
      property: 'gap',
    },
  })
  .asClass();
