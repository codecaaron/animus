import { ds } from '../../setup';

export const PatternA = ds
  .styles({
    color: 'text',
    cursor: 'pointer',
    '&:hover': { color: 'primary' },
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
    },
  })
  .asElement('button');

export const AppA = () => <PatternA />;
