import { animus } from '@animus/props';

export const ContentContainer = animus
  .styles({
    area: 'content',
    maxHeight: 1,
    maxWidth: 1,
    size: 1,
    py: 24,
    px: 48,
    overflowY: 'auto',
  })
  .asComponent('div');

export const Content: React.FC = ({ children }) => {
  return <ContentContainer>{children}</ContentContainer>;
};
