import { ds } from '../../setup';

export const PatternH = ds
  .styles({
    color: 'text',
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
    },
  })
  .asElement('div');
