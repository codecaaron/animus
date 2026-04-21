import { ds } from '../setup';

// Pattern A — raw '&:selector' key mixed with _aliased key in the same .styles({}).
// Mirrors CloseButton.tsx and Shell.tsx's ModeTrigger. Observed in build: total
// component drop (0 rules emitted).
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
