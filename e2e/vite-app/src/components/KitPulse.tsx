import { kitMotion } from '@animus-ui/test-ds';

import { ds } from '../ds';

// External keyframe-collection consumer (rust-extraction-pipeline › "External
// package collection discovered from its entry"): `kitMotion` is created and
// exported by the test-ds package ENTRY module, and this component references
// it through a plain named import — the app's ds.ts does NOT re-export it. The
// extractor's keyframes scan must discover the collection from the external
// entry, resolve `kitMotion.pulse` to its `animus-kf-<hash>` name, and emit the
// matching @keyframes block exactly once. Pulse.tsx (app-local
// `animations.pulse` from ds.ts) is the inline sibling in the same sheet;
// assertKeyframesUniqueBodies pins that no frame body is ever emitted twice.
export const KitPulse = ds
  .styles({
    bg: 'secondary',
    color: 'background',
    px: 16,
    py: 8,
    borderRadius: '4px',
    animationName: kitMotion.pulse,
    animationDuration: '2s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  })
  .asElement('span');
