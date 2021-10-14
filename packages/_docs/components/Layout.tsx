import { animus } from '@animus/props';

export const Layout = animus
  .styles({
    display: 'grid',
    minHeight: '100vh',
    maxHeight: '100vh',
    width: 1,
    gridTemplateColumns: '20rem 1fr',
    gridTemplateRows: '5rem 1fr',
    gridTemplateAreas: '"header header" "sidebar content"',
  })
  .asComponent('div');
