import { animus } from '@animus/props';

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
    mode: true,
  })
  .asComponent('div');
