import { kitMotion } from '@animus-ui/test-ds';

import { ds } from '../ds';

// Sealed-kit keyframe consumer (rust-extraction-pipeline › "Sealed kit
// collection resolves in the consumer"): `kitMotion` is defined and
// registered inside test-ds's definition graph, re-exported from the package
// root, and this component references it through a plain named import — the
// app's ds.ts does NOT re-export it. The collection reaches the app through
// the sealed kit's registration record via `.extend()`; the extractor
// resolves `kitMotion.pulse` by the export name at the defining module and
// emits the matching @keyframes block exactly once. Pulse.tsx (app-local
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
