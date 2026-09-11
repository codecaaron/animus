import { ds } from '../../setup';

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
