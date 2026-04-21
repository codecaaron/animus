import { createElement } from 'react';

import { ds } from '../setup';

// Pattern E — component rendered via React.createElement() with a bare
// identifier (not JSX, not member expression). Mirrors CloseButton's usage in
// Drawer.tsx where `createElement(CloseButton, { onClick: ... })` is the only
// reference. Observed in showcase dist: CloseButton dropped entirely.
//
// Hypothesis: JSX scanner recognizes <Component> and <Namespace.Member>
// usages, but does NOT recognize createElement(bareIdent, ...) as rendering.
// Reconciler then eliminates as "not rendered and not a parent."
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
