import { ds } from '../test-system';

export const LayoutContainer = ds
  .styles({
    position: 'relative',
    zIndex: 1,
    overflow: 'hidden',
    bg: 'background',
    minHeight: '100vh',
    width: 1,
    display: 'grid',
    color: 'text',
    fontSize: { _: 16, xs: 18 },
  })
  .states({
    loading: {
      opacity: 0,
    },
    sidebar: {
      gridTemplateAreas: {
        _: '"header header" "content content"',
        sm: '"header header" "sidebar content"',
      },
    },
  })
  .asElement('div');

export const ContentContainer = ds
  .styles({
    pt: { _: 24, sm: 48 },
    px: { _: 24, sm: 64, xl: 96 },
    position: 'relative',
  })
  .asElement('div');

const SidebarContainer = ds
  .styles({
    position: { sm: 'static' },
  })
  .asElement('div');
