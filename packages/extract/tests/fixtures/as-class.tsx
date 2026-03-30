import { ds } from '../test-system';

// Static .asClass() — no variants, no groups
export const card = ds
  .styles({
    display: 'flex',
    p: 16,
    borderRadius: 4,
  })
  .asClass();

// Dynamic .asClass() — with variants
export const button = ds
  .styles({
    display: 'inline-flex',
    cursor: 'pointer',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { p: 4, fontSize: 14 },
      lg: { p: 16, fontSize: 18 },
    },
  })
  .asClass();

// Mixed file — .asElement() alongside .asClass()
export const Box = ds
  .styles({
    display: 'block',
    position: 'relative',
  })
  .asElement('div');
