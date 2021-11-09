import { animus } from '@animus/props';

export const ContentContainer = animus
  .styles({
    maxHeight: 1,
    maxWidth: 1,
    size: 1,
    py: { _: 24, lg: 32 },
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
