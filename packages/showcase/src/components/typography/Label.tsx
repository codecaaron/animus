import { ds } from '../../ds';

export const Label = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: '0.3em',
    textTransform: 'uppercase',
    color: 'textMuted',
    m: 0,
  })
  .groups({ text: true, surface: true, space: true, arrange: true })
  .asElement('span');
