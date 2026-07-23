// Corpus fixture (modern-css-surface inc 06) — blessed into the committed oracle.
// Built-in media-feature condition alias `_motionReduce` (design D8). Unlike
// condition-aliased.tsx (which proves a USER-registered alias), this proves the
// BUILT-IN ships in the manifest with no explicit registration: the harness
// condition map carries the built-in set, so `_motionReduce` resolves to
// `@media (prefers-reduced-motion: reduce)`.
// Spec: media-condition-aliases §"Built-in media-feature condition aliases" —
// scenario "Built-in motion alias".
import { ds } from '../test-system';

export const MotionCard = ds
  .styles({
    p: 8,
    _motionReduce: { transition: 'none' },
  })
  .asElement('div');
export const App = () => <MotionCard />;
