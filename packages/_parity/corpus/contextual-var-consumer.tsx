// The theme declares the contextual var `background-current`, and the `bg` prop
// carries `currentVar: '--current-bg'` — the property read below.
import { ds } from '../test-system';

export const ContextualCard = ds
  .styles({
    bg: 'background-current',
    p: 8,
    '@container card (min-width: 400px)': {
      borderTopColor: 'var(--current-bg)',
      borderTopStyle: 'solid',
      borderTopWidth: '1px',
    },
  })
  .asElement('div');
export const App = () => <ContextualCard />;
