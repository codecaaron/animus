import { ds } from '../test-system';

export const ContainerCard = ds
  .styles({
    p: 8,
    '@container card (min-width: 400px)': { p: 16, display: 'grid' },
  })
  .asElement('div');
export const App = () => <ContainerCard />;
