// Corpus fixture (modern-css-surface inc 03) — blessed into the committed oracle.
// Registered condition-alias block key. `_motionReduce` resolves through the
// harness-supplied condition registry (HARNESS_CONDITION_ALIASES in
// packages/_parity/src/engine-run.ts) to
// `@media (prefers-reduced-motion: reduce)`.
import { ds } from '../test-system';

export const AliasedCard = ds
  .styles({
    p: 8,
    _motionReduce: { display: 'none' },
  })
  .asElement('div');
export const App = () => <AliasedCard />;
