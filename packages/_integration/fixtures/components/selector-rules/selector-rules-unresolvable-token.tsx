import { ds } from '../../setup';

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
