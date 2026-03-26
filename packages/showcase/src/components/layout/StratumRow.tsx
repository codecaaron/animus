import { ds } from '../../ds';

export const StratumRow = ds
  .styles({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    p: 16,
    borderLeft: 3,
    borderColor: 'ash',
    transition: 'border-color 0.3s ease, background 0.15s ease',
    '&:hover': {
      borderColor: 'accent',
      bg: 'rgba(255,182,39,0.03)',
    },
  })
  .variant({
    prop: 'kind',
    variants: {
      base: {
        bg: 'rgba(255,40,0,0.04)',
      },
      variants: { bg: 'rgba(255,40,0,0.08)' },
      states: { bg: 'rgba(255,40,0,0.12)' },
      groups: {
      bg: 'rgba(255,40,0,0.16)' 
      },
      terminal: {
        borderColor: 'primary',
        bg: 'rgba(255,40,0,0.3)',
      },
    },
  })
  .groups({ space: true, surface: true, arrange: true })
  .asElement('div');
