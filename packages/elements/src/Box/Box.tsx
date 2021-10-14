import { animus } from '@animus/props';

export const Box = animus
  .states({
    fit: { width: 1, height: 1 },
    isolate: { position: 'relative', zIndex: 1 },
    'no-select': {
      WebkitTouchCallout: 'none',
      userSelect: 'none',
    },
  })
  .systemProps({
    layout: true,
    positioning: true,
    space: true,
    color: true,
    shadows: true,
  })
  .asComponent('div');
