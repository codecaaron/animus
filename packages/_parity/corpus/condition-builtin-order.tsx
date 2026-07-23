// Corpus fixture (modern-css-surface inc 06) — blessed into the committed oracle.
// ORDERING PROBE (design D4 + ORDER BAND): a built-in condition alias and a
// user-band alias in the same style object must emit by registry `order`. The
// built-in `_osDark` sits in the reserved built-in band (order 370); the
// harness-registered `_motionReduce` sits in the user band (order 500). The
// emitted CSS must therefore wrap `@media (prefers-color-scheme: dark)` BEFORE
// `@media (prefers-reduced-motion: reduce)` — built-in band below user band.
import { ds } from '../test-system';

export const OrderProbe = ds
  .styles({
    p: 8,
    // authored user-first to prove emission sorts by order, not source order
    _motionReduce: { transition: 'none' },
    _osDark: { colorScheme: 'dark' },
  })
  .asElement('div');
export const App = () => <OrderProbe />;
