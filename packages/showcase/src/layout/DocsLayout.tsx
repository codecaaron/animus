import { Outlet } from 'react-router-dom';

import { Sidebar } from '../components';
import { ds } from '../ds';

const DocsContainer = ds
  .styles({
    display: 'flex',
    maxWidth: '64rem',
    mx: 'auto',
    px: 24,
    py: 48,
    gap: 32,
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
