import { animations, ds } from '../../ds';

/**
 * Demonstrates the `ember` keyframe ref from the top-level `keyframes()`
 * collection. Used in the global-styles documentation to show per-key branded
 * ref access and to anchor extraction proof for the `ember` keyframe.
 */
export const EmberGlow = ds
  .styles({
    display: 'inline-block',
    fontFamily: 'logo',
    fontWeight: 700,
    color: 'primary',
    textShadow: 'logo',
    animationName: animations.ember,
    animationDuration: '4s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    '@media (prefers-reduced-motion: reduce)': {
      animationName: 'none',
    },
  })
  .asElement('span');
