import { animus } from '@animus-ui/core';

export const Image = animus
  .groups({
    layout: true,
    color: true,
    positioning: true,
    space: true,
  })
  .asComponent('img');
