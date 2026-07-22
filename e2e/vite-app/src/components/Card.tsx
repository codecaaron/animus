import { ds } from '../ds';

export const Card = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    p: 16,
    // Registered condition-alias block (modern-css-surface inc 03). Resolves
    // through the app's `_motionReduce` registration to
    // `@media (prefers-reduced-motion: reduce)` — the aliased-emission proof.
    _motionReduce: {
      transition: 'none',
    },
  })
  .asElement('div');
