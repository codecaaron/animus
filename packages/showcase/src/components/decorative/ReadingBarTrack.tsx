import { ds } from '../../ds';

export const ReadingBarTrack = ds
  .styles({
    position: 'fixed',
    bottom: 0,
    left: 0,
    height: '3px',
    width: '0%',
    bg: 'primary',
    boxShadow: 'glow-ember-lg',
    zIndex: 200,
    pointerEvents: 'none',
  })
  .asElement('div');
