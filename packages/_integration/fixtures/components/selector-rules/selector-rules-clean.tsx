import { ds } from '../../setup';

export const PatternC = ds
  .styles({
    color: 'text',
    cursor: 'pointer',
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
    },
  })
  .asElement('button');

export const AppC = () => <PatternC />;
