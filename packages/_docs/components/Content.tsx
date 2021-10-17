import { animus } from '@animus/props';
import { Background } from '@animus/provider';

export const ContentContainer = animus
  .styles({
    area: 'content',
    maxHeight: 1,
    maxWidth: 1,
    size: 1,
    py: 24,
    px: { _: 48, xl: 96 },
  })
  .asComponent('div');

export const Content: React.FC = ({ children }) => {
  return (
    <Background bg="white" overflowY="auto">
      <ContentContainer>{children}</ContentContainer>
    </Background>
  );
};
