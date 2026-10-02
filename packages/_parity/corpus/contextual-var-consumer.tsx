// The theme declares the contextual var `background-current`, and the `bg` prop
// carries `currentVar: '--current-bg'` — the property read below. The read
// uses the unregistered `borderBlockStartColor` longhand, which accepts raw CSS;
// the registered `borderTopColor` is strict and omits a raw `var()`.
import { ds } from '../test-system';

export const ContextualCard = ds
  .styles({
    bg: 'background-current',
    p: 8,
    '@container card (min-width: 400px)': {
      borderBlockStartColor: 'var(--current-bg)',
      borderTopStyle: 'solid',
      borderTopWidth: '1px',
    },
  })
  .asElement('div');
export const App = () => <ContextualCard />;
