import { createElement } from 'react';

import { ds } from '../../setup';

// Pattern E — component rendered via React.createElement() with a bare
// identifier (not JSX, not member expression). Mirrors CloseButton's usage in
// Drawer.tsx where `createElement(CloseButton, { onClick: ... })` is the only
// reference. This historical regression is fixed: bare-identifier
// `createElement` usage is recognized as rendering and remains guarded by the
// selector-rules integration test.
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
