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
    // UNREGISTERED built-in (inc 06 composite witness): this app never
    // registers `_osDark` — it resolves through the DEFAULT built-in set via
    // the full SystemBuilder → manifest → plugin glue → engine path. The
    // assert lane pins its emission.
    _osDark: {
      borderColor: 'border',
    },
  })
  .asElement('div');
