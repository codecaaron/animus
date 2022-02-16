import { animus } from '@animus-ui/core';
import { flow } from 'components/FlowLink';

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
    animation: `${flow} 5s linear 1s infinite`,
    fontSize: 16,
  })
  .states({
    loading: {
      opacity: 0,
    },
    sidebar: {
      fontSize: 14,
      gap: 2,
      gridTemplateAreas: '"header header" "sidebar content"',
      height: '100vh',
    },
  })
  .asComponent('div');
