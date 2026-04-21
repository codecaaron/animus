import { ds } from '../setup';

// Pattern D — two _aliased keys including one with a compound selector alias
// (_selected → '&:[aria-selected="true"], &[data-selected]'), plus a token ref
// inside a shorthand value. Mirrors TabGroup.tsx's TabButton. Observed in build:
// total component drop (0 rules).
export const PatternD = ds
  .styles({
    color: 'text',
    cursor: 'pointer',
    _hover: { color: 'primary' },
    _focusVisible: {
      outline: '2px solid {colors.primary}',
      outlineOffset: '-2px',
    },
    _selected: {
      color: 'secondary',
    },
  })
  .asElement('button');

export const AppD = () => <PatternD />;
