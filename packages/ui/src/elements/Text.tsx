import { animus } from '@animus/core';

export const Text = animus
  .styles({ m: 0 })
  .variant({
    prop: 'as',
    variants: {
      h1: {
        fontSize: 64,
        fontWeight: 700,
      },
      h2: { fontSize: 44, fontWeight: 700 },
      h3: { fontSize: 34, fontWeight: 700 },
      h4: { fontSize: 26, fontWeight: 700 },
      h5: { fontSize: 22, fontWeight: 700 },
      h6: { fontSize: 18, fontWeight: 700 },
      p: { fontSize: 16 },
      small: { fontSize: 14 },
    },
  })
  .systemProps({
    layout: true,
    typography: true,
    color: true,
    space: true,
  })
  .asComponent('span');
