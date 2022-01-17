import { animus } from '@animus-ui/core';

export const ContentContainer = animus
  .styles({
    maxHeight: 1,
    maxWidth: 1,
    size: 1,
    py: { _: 8, lg: 12 },
    px: { _: 48, xl: 96 },
    overflow: 'auto',
    position: 'relative',
    zIndex: 1,
    area: 'content',
  })
  .asComponent('div');

export const Content: React.FC = ({ children }) => {
  return <ContentContainer>{children}</ContentContainer>;
};
