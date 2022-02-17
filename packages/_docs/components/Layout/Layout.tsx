import { animus } from '@animus-ui/core';

import { flow } from '../../animations/flow';

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
    gradient: 'flowX',
    animation: `${flow} 15s linear infinite`,
    fontSize: 18,
  })
  .states({
    loading: {
      opacity: 0,
    },
    sidebar: {
      gap: 2,
      gridTemplateAreas: {
        _: '"header header" "content content"',
        sm: '"header header" "sidebar content"',
      },
      height: '100vh',
    },
  })
  .asComponent('div');
