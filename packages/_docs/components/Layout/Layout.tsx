import { animus } from '@animus-ui/core';

export const Layout = animus
  .styles({
    bg: 'background',
    minHeight: '100vh',
    width: 1,
    display: 'grid',
    gridTemplateColumns: '15rem minmax(0, 1fr)',
    gridTemplateRows: 'max-content 1fr',
    gridTemplateAreas: '"header header" "content content"',
  })
  .states({
    sidebar: {
      gridTemplateAreas: '"header header" "sidebar content"',
      height: '100vh',
    },
  })
  .asComponent('div');
