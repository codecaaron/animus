import { animus } from '@animus-ui/core';

export const VariableProvider = animus
  .styles({ color: 'text' })
  .groups({
    layout: true,
    color: true,
    grid: true,
    flex: true,
    positioning: true,
    space: true,
    borders: true,
    background: true,
    vars: true,
  })
  .asComponent('div');
