import { animus } from '@syzygos/core';

export const Image = animus
  .groups({
    layout: true,
    color: true,
    positioning: true,
    space: true,
  })
  .asElement('img');
