import { animations, ds } from '../ds';

export const Pulse = ds
  .styles({
    bg: 'primary',
    color: 'text',
    px: 16,
    py: 8,
    borderRadius: '4px',
    animationName: animations.pulse,
    animationDuration: '2s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  })
  .asElement('span');

export const Fade = ds
  .styles({
    bg: 'surface',
    color: 'text',
    px: 16,
    py: 8,
    borderRadius: '4px',
    animationName: animations.fadeIn,
    animationDuration: '1s',
    animationFillMode: 'forwards',
  })
  .asElement('span');
