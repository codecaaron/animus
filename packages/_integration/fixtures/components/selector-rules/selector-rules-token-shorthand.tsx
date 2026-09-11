import { ds } from '../../setup';

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
