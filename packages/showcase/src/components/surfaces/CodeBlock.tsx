import { ds } from '../../ds';

export const CodeBlock = ds
  .styles({
    fontFamily: 'mono',
    fontSize: 13,
    lineHeight: 'relaxed',
    bg: 'code',
    color: 'text',
    border: 1,
    borderColor: 'code-border',
    borderRadius: 0,
    p: 32,
    m: 0,
    overflow: 'auto',
    whiteSpace: 'pre',
  })
  .system({ space: true, surface: true })
  .asElement('pre');
