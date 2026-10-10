import { ds } from '../test-system';

// Mixed static and non-static properties — should extract the static ones,
// skip the non-static one, and still produce a class name.
const gradient = ['linear-gradient(', '#000', ')'].join('');
export const Hero = ds
  .styles({
    display: 'flex',
    color: 'primary',
    p: 24,
    background: gradient,
  })
  .asElement('div');

// Non-static inside a pseudo-selector block — the static property inside
// the pseudo block should still be extracted.
const hoverColor = 'dynamic';
export const HoverCard = ds
  .styles({
    p: 16,
    '&:hover': {
      color: hoverColor,
      bg: 'secondary',
    },
  })
  .asElement('div');

// Spread element — structural bail, entire object fails.
// This component should NOT be extracted at all.
const baseStyles = { display: 'flex' };
export const SpreadComponent = ds
  .styles({
    ...baseStyles,
    color: 'primary',
  })
  .asElement('div');
