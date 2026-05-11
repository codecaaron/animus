import { ds } from '../../ds';

export const InlineCode = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    bg: 'code',
    color: 'code.text',
    px: 6,
    py: 2,
    display: 'inline',
  })
  .asElement('code');
