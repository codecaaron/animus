import { compose } from '@animus-ui/system';
import { Outlet } from 'react-router-dom';

import { PageNav } from '../components/docs/PageNav';
import { PageToc } from '../components/docs/PageToc';
import { Sidebar } from '../components/docs/Sidebar';
import { ds } from '../ds';

// ─── Layout Slots ──────────────────────────────────────────────────
//
// Three-column docs layout composed via shared `collapse` variant.
// Single tree — responsive display values inside the `full` variant
// hide sidebar/toc at breakpoints. Can't use two trees because
// <Outlet /> would render twice, duplicating content in the DOM.

const LayoutRoot = ds
  .styles({
    display: 'grid',
    gap: 32,
    px: 24,
    pb: 0,
    mx: 'auto',
    maxWidth: '1440px',
  })
  .variant({
    prop: 'collapse',
    defaultVariant: 'full',
    variants: {
      full: {
        gridTemplateColumns: {
          _: '1fr',
          sm: '{sizes.sidebarWidth} 1fr',
          md: '{sizes.sidebarWidth} 1fr {sizes.tocWidth}',
        },
      },
      content: { gridTemplateColumns: '{sizes.sidebarWidth} 1fr' },
      focused: { gridTemplateColumns: '1fr' },
    },
  })
  .asElement('div');

const LayoutSidebar = ds
  .styles({
    position: 'sticky',
    top: '{sizes.navHeight}',
    maxHeight: 'calc(100vh - {sizes.navHeight})',
    overflowY: 'auto',
    flexShrink: '0',
    '&::-webkit-scrollbar-thumb': {
      bg: 'transparent',
      transition: 'background-color 0.3s ease',
    },
    '&:hover::-webkit-scrollbar-thumb': { bg: 'scrollbar' },
  })
  .variant({
    prop: 'collapse',
    defaultVariant: 'full',
    variants: {
      full: { display: { _: 'none', sm: 'block' } },
      content: { display: 'block' },
      focused: { display: 'none' },
    },
  })
  .asElement('aside');

const LayoutContent = ds
  .styles({
    minWidth: '0',
    maxWidth: '48rem',
    minHeight: 'calc(100vh - {sizes.navHeight})',
    overflow: 'hidden',
    pt: 48,
    pb: 48,
  })
  .variant({
    prop: 'collapse',
    defaultVariant: 'full',
    variants: {
      full: {},
      content: {},
      focused: { maxWidth: 'none', mx: 'auto' },
    },
  })
  .asElement('div');

const LayoutToc = ds
  .styles({
    position: 'sticky',
    top: '{sizes.navHeight}',
    maxHeight: 'calc(100vh - {sizes.navHeight})',
    overflowY: 'auto',
    '&::-webkit-scrollbar-thumb': {
      bg: 'transparent',
      transition: 'background-color 0.3s ease',
    },
    '&:hover::-webkit-scrollbar-thumb': { bg: 'scrollbar' },
  })
  .variant({
    prop: 'collapse',
    defaultVariant: 'full',
    variants: {
      full: { display: { _: 'none', md: 'block' } },
      content: { display: 'none' },
      focused: { display: 'none' },
    },
  })
  .asElement('aside');

export const Layout = compose(
  {
    Root: LayoutRoot,
    Sidebar: LayoutSidebar,
    Content: LayoutContent,
    Toc: LayoutToc,
  },
  { shared: { collapse: true } }
);

// ─── Page Component ────────────────────────────────────────────────

export function DocsLayout() {
  return (
    <Layout.Root collapse="full">
      <Layout.Sidebar>
        <Sidebar />
      </Layout.Sidebar>
      <Layout.Content>
        <Outlet />
        <PageNav />
      </Layout.Content>
      <Layout.Toc>
        <PageToc />
      </Layout.Toc>
    </Layout.Root>
  );
}
