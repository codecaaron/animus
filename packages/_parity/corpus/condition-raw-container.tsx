// Staged corpus fixture (modern-css-surface inc 03) — NOT yet blessed.
// Raw @container block key (named container + declarations). Resolves through
// the test-system config; no condition-alias registration needed.
import { ds } from '../test-system';

export const ContainerCard = ds
  .styles({
    p: 8,
    '@container card (min-width: 400px)': { p: 16, display: 'grid' },
  })
  .asElement('div');
export const App = () => <ContainerCard />;
