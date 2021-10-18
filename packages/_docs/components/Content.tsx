import { animus } from '@animus/props';
import { Background } from '@animus/provider';

export const ContentContainer = animus
  .styles({
    maxHeight: 1,
    maxWidth: 1,
    size: 1,
    py: { _: 24, lg: 32 },
    px: { _: 48, xl: 96 },
    overflowX: 'auto',
    position: 'relative',
    zIndex: 1,
  })
  .asComponent('div');

export const Content: React.FC = ({ children }) => {
  return (
    <Background bg="white" display="grid">
      <ContentContainer>{children}</ContentContainer>
    </Background>
  );
};
