import { animus } from '@animus-ui/core';

export const Box = animus
  .states({
    fit: { width: 1, height: 1 },
    isolate: { position: 'relative', zIndex: 1 },
  })
  .systemProps({
    layout: true,
    positioning: true,
    space: true,
    color: true,
    shadows: true,
    borders: true,
    background: true,
  })
  .asComponent('div');
