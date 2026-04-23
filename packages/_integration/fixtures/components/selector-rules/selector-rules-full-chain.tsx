import { ds } from '../../setup';

// Pattern G — close mirror of CopyButton's authoring. Full chain:
// .styles({ ..., _hover: {...}, _focusVisible: {...token ref...} })
// .variant({...}).states({...}).asElement('button').
// Observed in showcase dist: base + _hover + variants + states all extract,
// but :focus-visible drops. This isolates the chain-richness interaction.
export const PatternG = ds
  .styles({
    color: 'text',
    cursor: 'pointer',
    _hover: {
      color: 'primary',
    },
    _focusVisible: {
      outline: '2px solid {colors.primary}',
      outlineOffset: '2px',
    },
  })
  .variant({
    prop: 'size',
    defaultVariant: 'small',
    variants: {
      small: { fontSize: 14 },
      medium: { fontSize: 16 },
    },
  })
  .states({
    pressed: { color: 'secondary' },
  })
  .asElement('button');

export const AppG = () => <PatternG size="small" pressed />;
