import { animus } from '@animus-ui/core';

export const Box = animus
  .styles({ display: 'flex', position: 'relative' })
  .states({ fit: { width: 1, height: 1 } })
  .system({ space: true, layout: true })
  .asElement('div');

export const FlexBox = animus
  .styles({ display: 'flex' })
  .system({ space: true, layout: true, flex: true })
  .asElement('div');
