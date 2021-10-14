import { animus } from '@animus/props';

export const FlexBox = animus
  .styles({ display: 'flex' })
  .states({
    fit: { width: 1, height: 1 },
    isolate: { position: 'relative', zIndex: 1 },
    'no-select': {
      WebkitTouchCallout: 'none',
      userSelect: 'none',
    },
    inline: {
      display: 'inline-flex',
    },
    wrap: {
      flexWrap: 'wrap',
    },
    center: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    row: {
      flexDirection: 'row',
    },
    column: {
      flexDirection: 'column',
    },
  })
  .systemProps({
    layout: true,
    positioning: true,
    space: true,
    color: true,
    shadows: true,
    flex: true,
  })
  .asComponent('div');
