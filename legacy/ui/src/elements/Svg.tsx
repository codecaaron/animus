import { animus } from '@animus-ui/core';

export const Svg = animus
  .system({
    layout: true,
    color: true,
    positioning: true,
    space: true,
  })
  .asElement('svg');
