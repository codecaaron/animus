import { animus } from '@animus-ui/core';

export const VariableProvider = animus
  .styles({ color: 'text' })
  .systemProps({
    layout: true,
    color: true,
    grid: true,
    flex: true,
    positioning: true,
    space: true,
    borders: true,
    background: true,
  })
  .asComponent('div');
