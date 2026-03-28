import { ds } from '../../ds';

export const StratumRow = ds
  .styles({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    p: 16,
    borderLeft: 3,
    borderColor: 'border',
    transition: 'border-color 0.3s ease, background 0.15s ease',
    '&:hover': {
      borderColor: 'accent',
      background: '{colors.gold-300/3}',
    },
  })
  .variant({
    prop: 'kind',
    variants: {
      base: {
        background: '{colors.fire-500/4}',
      },
      variants: { background: '{colors.fire-500/8}' },
      states: { background: '{colors.fire-500/12}' },
      groups: {
        background: '{colors.fire-500/16}',
      },
      terminal: {
        borderColor: 'primary',
        background: '{colors.fire-500/30}',
      },
    },
  })
  .groups({ space: true, surface: true, arrange: true })
  .asElement('div');
