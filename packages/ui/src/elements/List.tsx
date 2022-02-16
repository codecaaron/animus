import { animus } from '@animus-ui/core';

export const Ul = animus
  .styles({ mb: 16, pl: 20, lineHeight: 'base' })
  .states({
    plain: {
      m: 0,
      p: 0,
    },
  })
  .groups({
    layout: true,
    color: true,
    positioning: true,
    space: true,
  })
  .asComponent('ul');

export const Ol = animus
  .styles({ mb: 16, pl: 20, lineHeight: 'base' })
  .states({
    plain: {
      m: 0,
      p: 0,
    },
  })
  .groups({
    layout: true,
    color: true,
    positioning: true,
    space: true,
  })
  .asComponent('ol');

export const Li = animus
  .styles({ m: 0 })
  .groups({
    layout: true,
    typography: true,
    color: true,
    space: true,
  })
  .asComponent('li');
