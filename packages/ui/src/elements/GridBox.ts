import { animus } from '@animus-ui/core';

export const GridBox = animus
  .styles({ display: 'grid' })
  .states({
    fit: { width: 1, height: 1 },
    isolate: { position: 'relative', zIndex: 1 },
    center: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    row: {
      gridAutoFlow: 'row',
    },
    column: {
      gridAutoFlow: 'column',
    },
  })
  .groups({
    layout: true,
    positioning: true,
    space: true,
    color: true,
    shadows: true,
    borders: true,
    background: true,
    grid: true,
  })
  .asElement('div');
