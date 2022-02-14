import { animus } from '@animus-ui/core';

export const Layout = animus
  .styles({
    bg: 'background',
    minHeight: '100vh',
    overflowY: 'auto',
    width: 1,
    display: 'grid',
    cols: '15rem:1',
    rows: 'max:1',
    gridTemplateAreas: '"header header" "content content"',
    color: 'text',
    fontFamily: 'base',
    opacity: 1,
  })
  .states({
    loading: {
      opacity: 0,
    },
    sidebar: {
      gridTemplateAreas: '"header header" "sidebar content"',
      height: '100vh',
    },
  })
  .asComponent('div');
