import { animus } from '@animus/props';

export const Svg = animus
  .systemProps({
    layout: true,
    color: true,
    positioning: true,
    space: true,
  })
  .asComponent('svg');
