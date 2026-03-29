import { ds } from '../../ds';

export const Callout = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 14,
    fontWeight: 500,
    bg: 'primary',
    color: 'bg',
    p: 16,
    m: 0,
  })
  .system({ text: true, surface: true, space: true })
  .asElement('div');
