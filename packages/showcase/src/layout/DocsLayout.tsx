import { Outlet } from 'react-router-dom';

import { ds } from '../ds';
import { Sidebar } from '../components';

const DocsContainer = ds
  .styles({
    display: 'flex',
    maxWidth: '72rem',
    mx: 'auto',
    px: 24,
    py: 48,
    gap: '48px',
  })
  .groups({ space: true })
  .asElement('div');

const Content = ds
  .styles({
    flex: '1',
    minWidth: '0',
    maxWidth: '48rem',
  })
  .asElement('div');

export function DocsLayout() {
  return (
    <DocsContainer>
      <Sidebar />
      <Content>
        <Outlet />
      </Content>
    </DocsContainer>
  );
}
