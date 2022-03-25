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
  .asElement('ul');

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
  .asElement('ol');

export const Li = animus
  .styles({ m: 0 })
  .groups({
    layout: true,
    typography: true,
    color: true,
    space: true,
  })
  .asElement('li');
