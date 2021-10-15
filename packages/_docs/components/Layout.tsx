import { animus } from '@animus/props';

export const Layout = animus
  .styles({
    bg: 'background',
    display: 'grid',
    minHeight: '100vh',
    maxHeight: '100vh',
    width: 1,
    gridTemplateColumns: '18rem 1fr',
    gridTemplateRows: 'max-content minmax(0, 1fr)',
    gridTemplateAreas: '"header header" "sidebar content"',
  })
  .asComponent('div');
