import { animations, ds } from '../../ds';

/**
 * Demonstrates the `tallyPulse` keyframe ref from the top-level `keyframes()`
 * collection. Used in the global-styles documentation to show per-key branded
 * ref access and to anchor extraction proof for the `tallyPulse` keyframe.
 */
export const TallyPulse = ds
  .styles({
    display: 'inline-block',
    animationName: animations.tallyPulse,
    animationDuration: '1.5s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
    },
  })
  .asElement('span');
