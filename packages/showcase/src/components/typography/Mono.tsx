import { ds } from '../../ds';

export const Mono = ds
  .styles({
    fontFamily: 'mono',
    fontWeight: 400,
    lineHeight: 'snug',
    color: 'text',
    m: 0,
  })
  .system({ text: true, surface: true, space: true, transition: true })
  .asElement('span');
