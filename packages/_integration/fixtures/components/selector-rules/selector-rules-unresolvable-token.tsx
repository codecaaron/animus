import { ds } from '../../setup';

// Pattern F — unresolvable token ref inside a shorthand string value inside
// an _aliased block. Mirrors the partial-drop failure mode (CopyButton uses
// `{colors.scheme.300}`, which may not resolve against the base theme).
// Observed in showcase dist: base rules extract, :focus-visible rule drops.
export const PatternF = ds
  .styles({
    color: 'text',
    cursor: 'pointer',
    _focusVisible: {
      outline: '2px solid {colors.does-not-exist.999}',
      outlineOffset: '2px',
    },
  })
  .asElement('button');

export const AppF = () => <PatternF />;
