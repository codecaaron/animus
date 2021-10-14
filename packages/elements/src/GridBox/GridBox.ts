import { animus } from '@animus/props';

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
  .systemProps({
    layout: true,
    positioning: true,
    space: true,
    color: true,
    shadows: true,
    grid: true,
  })
  .asComponent('div');
