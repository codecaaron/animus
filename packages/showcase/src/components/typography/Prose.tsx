import { ds } from '../../ds';

export const Prose = ds
  .styles({
    fontFamily: 'body',
    fontWeight: 300,
    lineHeight: 'relaxed',
    color: 'text-muted',
    m: 0,
  })
  .groups({ text: true, surface: true, space: true, arrange: true })
  .asElement('p');
