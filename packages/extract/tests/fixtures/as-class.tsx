import { animus } from '@animus-ui/core';

// Static .asClass() — no variants, no groups
export const card = animus
  .styles({
    display: 'flex',
    p: 16,
    borderRadius: 4,
  })
  .asClass();

// Dynamic .asClass() — with variants
export const button = animus
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
export const Box = animus
  .styles({
    display: 'block',
    position: 'relative',
  })
  .asElement('div');
