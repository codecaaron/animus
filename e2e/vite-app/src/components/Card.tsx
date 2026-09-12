import { ds } from '../ds';

export const Card = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    bg: 'surface',
    border: '1px solid',
    borderColor: 'border',
    p: 16,
    _motionReduce: {
      transition: 'none',
    },
    // This app never registers `_osDark`, so it resolves through the default
    // built-in set. The assert script pins its emission.
    _osDark: {
      borderColor: 'border',
    },
  })
  .asElement('div');
