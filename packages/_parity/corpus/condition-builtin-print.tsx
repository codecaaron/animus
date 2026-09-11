import { ds } from '../test-system';

export const PrintCard = ds
  .styles({
    display: 'block',
    _print: { display: 'none' },
  })
  .asElement('div');
export const App = () => <PrintCard />;
