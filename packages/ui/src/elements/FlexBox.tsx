import { animus } from '@animus-ui/core';

export const FlexBox = animus
  .styles({ display: 'flex' })
  .states({
    fit: { width: 1, height: 1 },
    isolate: { position: 'relative', zIndex: 1 },
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
  .groups({
    layout: true,
    positioning: true,
    space: true,
    color: true,
    shadows: true,
    borders: true,
    background: true,
    flex: true,
  })
  .asElement('div');
