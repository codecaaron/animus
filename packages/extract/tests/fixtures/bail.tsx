import { animus } from '@animus-ui/core';

export const Box = animus
  .states({
    fit: { width: 1, height: 1 },
  })
  .groups({
    layout: true,
    space: true,
    color: true,
  })
  .asElement('div');
