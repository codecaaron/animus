import { animus } from '@animus-ui/core';

export const Layout = animus
  .styles({
    position: 'relative',
    zIndex: 1,
    overflow: 'hidden',
    bg: 'background',
    minHeight: '100vh',
    width: 1,
    display: 'grid',
    cols: '15rem:1',
    rows: 'max:1',
    gridTemplateAreas: '"header header" "content content"',
    color: 'text',
    fontFamily: 'base',
    opacity: 1,
    fontSize: 18,
    '&:before': {
      zIndex: 0,
      content: '""',
      gradient: 'flowX',
      backgroundSize: '500px 100%',
      position: 'absolute',
      width: '300vmax',
      height: '300vh',
      left: 0.5,
      top: 0.5,
      transformOrigin: '50% 50%',
      transform: 'translate(-50%, -50%) rotate(45deg)',
    },
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
