import { ds } from '../../ds';

export const InlineCode = ds
  .styles({
    fontFamily: 'mono',
    fontSize: '13px',
    bg: 'coal',
    color: 'spark',
    px: 6,
    py: 2,
    display: 'inline',
  })
  .asElement('code');
