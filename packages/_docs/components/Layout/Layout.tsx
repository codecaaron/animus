import { animus } from '@syzygos/core';

const LayoutContainer = animus
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
    fontSize: { _: 16, xs: 18 },
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
  .asElement('div');

const ContentContainer = animus
  .styles({
    maxHeight: 1,
    maxWidth: 1,
    size: 1,
    pt: { _: 24, sm: 48 },
    pb: 96,
    px: { _: 24, sm: 64, xl: 96 },
    overflow: 'auto',
    position: 'relative',
    zIndex: 1,
    area: 'content',
    bg: 'background-current',
  })
  .asElement('div');

const HeaderContainer = animus
  .styles({
    width: 1,
    display: 'flex',
    justifyContent: 'center',
    position: 'sticky',
    top: 0,
    bg: 'background',
    height: '3.5rem',
    area: 'header',
    overflow: 'hidden',
    py: 4,
    px: { _: 16, sm: 32 },
    zIndex: 2,
  })
  .asElement('div');

export const SidebarContainer = animus
  .styles({
    bg: 'background-current',
    area: 'sidebar',
    height: 1,
    top: '4rem',
    maxHeight: 'calc(100vh - 3.5rem)',
    overflowY: 'auto',
    zIndex: 3,
    position: {
      _: 'absolute',
      sm: 'static',
    },
    right: 1,
    '::-webkit-scrollbar': {
      display: 'none',
    },
  })
  .asElement('div');

type LayoutContainer = typeof LayoutContainer;

export interface Layout extends LayoutContainer {
  Content: typeof ContentContainer;
  Header: typeof HeaderContainer;
  Sidebar: typeof SidebarContainer;
}

export const Layout = LayoutContainer as Layout;

Layout.Content = ContentContainer;
Layout.Sidebar = SidebarContainer;
Layout.Header = HeaderContainer;
