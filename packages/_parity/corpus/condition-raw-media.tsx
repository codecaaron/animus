// Corpus fixture (modern-css-surface inc 03) — blessed into the committed oracle.
// Raw non-breakpoint @media block key (media feature, not a breakpoint map).
import { ds } from '../test-system';

export const MotionCard = ds
  .styles({
    display: 'flex',
    '@media (prefers-reduced-motion: reduce)': { display: 'none' },
  })
  .asElement('div');
export const App = () => <MotionCard />;
