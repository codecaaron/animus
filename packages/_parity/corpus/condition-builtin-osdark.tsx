import { ds } from '../test-system';

export const OsDarkCard = ds
  .styles({
    display: 'flex',
    _osDark: { colorScheme: 'dark' },
  })
  .asElement('div');
export const App = () => <OsDarkCard />;
