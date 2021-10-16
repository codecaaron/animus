import { animus } from '@animus/props';

export const Layout = animus
  .styles({
    bg: 'background',
    minHeight: '100vh',
    maxHeight: '100vh',
    width: 1,
    display: 'grid',
    gridTemplateColumns: '18rem 1fr',
    gridTemplateRows: 'max-content 1fr',
    gridTemplateAreas: '"header header" "content content"',
  })
  .states({
    sidebar: {
      gridTemplateAreas: '"header header" "sidebar content"',
    },
  })
  .asComponent('div');
