import { ds } from '../setup';

// Control: single _aliased key with literal values + typed prop (no raw selector,
// no token ref inside shorthand). Mirrors SkipLink.tsx — the only working case
// in the audit.
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
