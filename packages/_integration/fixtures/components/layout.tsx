import { ds } from '../setup';

export const Container = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    px: { _: 16, sm: 24, lg: 48 },
    py: { _: 16, md: 32 },
  })
  .asElement('div');

export const Stack = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: { _: 8, sm: 16 },
  })
  .asElement('div');

export const App = () => (
  <Container>
    <Stack />
  </Container>
);
