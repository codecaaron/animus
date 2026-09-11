import { createElement } from 'react';

import { ds } from '../../setup';

export const PatternE = ds
  .styles({
    color: 'text',
    cursor: 'pointer',
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'primary',
    },
  })
  .asElement('button');

export const AppE = () => createElement(PatternE, {});
