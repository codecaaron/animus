import { animus } from '@animus-ui/core';

export const Content = animus
  .styles({
    maxHeight: 1,
    maxWidth: 1,
    size: 1,
    py: { _: 16, lg: 48 },
    px: { _: 64, xl: 96 },
    overflow: 'auto',
    position: 'relative',
    zIndex: 1,
    area: 'content',
    bg: 'background-current',
  })
  .asComponent('div');
