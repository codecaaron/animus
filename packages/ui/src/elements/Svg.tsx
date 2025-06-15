import { animus } from '@syzygos/core';

export const Svg = animus
  .groups({
    layout: true,
    color: true,
    positioning: true,
    space: true,
  })
  .asElement('svg');
