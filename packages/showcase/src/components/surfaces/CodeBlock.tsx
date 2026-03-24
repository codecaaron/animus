import { ds } from '../../ds';

export const CodeBlock = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    lineHeight: 'relaxed',
    bg: 'carbon',
    color: 'bone',
    border: 1,
    borderColor: 'ash',
    borderRadius: 0,
    p: 32,
    m: 0,
    overflow: 'auto',
    whiteSpace: 'pre',
  })
  .groups({ space: true, surface: true })
  .asElement('pre');
