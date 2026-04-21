import { ds } from '../setup';

// Pattern B — token ref embedded inside a shorthand string value inside an _aliased
// block. Mirrors CopyButton.tsx, NavBar.tsx, Heading.tsx. Observed in build: base
// styles extract but :focus-visible rule drops.
export const PatternB = ds
  .styles({
    color: 'text',
    cursor: 'pointer',
    _focusVisible: {
      outline: '2px solid {colors.primary}',
      outlineOffset: '2px',
    },
  })
  .asElement('button');

export const AppB = () => <PatternB />;
