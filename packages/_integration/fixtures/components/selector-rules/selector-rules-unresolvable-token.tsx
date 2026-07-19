import { ds } from '../../setup';

// Pattern F — unresolvable token ref inside a shorthand string value inside
// an _aliased block. v1 preserves the :focus-visible rule and raw unresolved
// outline declaration. v2 drops only that outline declaration and emits an
// unresolvable-alias warning; it preserves the surrounding rule.
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
