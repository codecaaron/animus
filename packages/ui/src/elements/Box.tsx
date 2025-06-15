import { animus } from '@syzygos/core';

export const Box = animus
  .states({
    fit: { width: 1, height: 1 },
    isolate: { position: 'relative', zIndex: 1 },
  })
  .groups({
    layout: true,
    positioning: true,
    space: true,
    color: true,
    shadows: true,
    borders: true,
    background: true,
    typography: true,
  })
  .asElement('div');
