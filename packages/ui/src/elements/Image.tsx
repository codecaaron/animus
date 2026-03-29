import { animus } from '@animus-ui/core';

export const Image = animus
  .system({
    layout: true,
    color: true,
    positioning: true,
    space: true,
  })
  .asElement('img');
