import { animus } from '@animus/props';

export const Image = animus
  .systemProps({
    layout: true,
    color: true,
    positioning: true,
    space: true,
  })
  .asComponent('img');
