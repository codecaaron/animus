import { ds } from '../../ds';

export const Display = ds
  .styles({
    fontFamily: 'display',
    fontWeight: 400,
    lineHeight: 'none',
    letterSpacing: '-0.03em',
    color: 'text',
    m: 0,
  })
  .system({ text: true, surface: true, space: true, motion: true })
  .asElement('h1');
