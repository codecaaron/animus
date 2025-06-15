import { animus } from '@syzygos/core';

export const Text = animus
  .styles({ m: 0 })
  .variant({
    prop: 'as',
    variants: {
      h1: {
        fontSize: 64,
        fontWeight: 700,
        lineHeight: 'title',
      },
      h2: { fontSize: 44, fontWeight: 700, lineHeight: 'title' },
      h3: { fontSize: 34, fontWeight: 700, lineHeight: 'title' },
      h4: { fontSize: 26, fontWeight: 700, lineHeight: 'title' },
      h5: { fontSize: 22, fontWeight: 700, lineHeight: 'title' },
      h6: { fontSize: 18, fontWeight: 700, lineHeight: 'title' },
      p: { lineHeight: 'base' },
      small: { fontSize: 14 },
    },
  })
  .groups({
    layout: true,
    typography: true,
    color: true,
    space: true,
  })
  .asElement('span');
