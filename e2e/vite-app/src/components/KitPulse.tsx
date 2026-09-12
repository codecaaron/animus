import { kitMotion } from '@animus-ui/test-ds';

import { ds } from '../ds';

// `kitMotion` is registered inside test-ds and reaches this app through
// `.extend()`; ds.ts deliberately does not re-export it.
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
