// Staged corpus fixture (modern-css-surface inc 03) — NOT yet blessed.
// Raw @supports block key (feature query, incl. token resolution in the body).
import { ds } from '../test-system';

export const SupportsCard = ds
  .styles({
    display: 'block',
    '@supports (display: grid)': { display: 'grid', color: 'primary' },
  })
  .asElement('div');
export const App = () => <SupportsCard />;
