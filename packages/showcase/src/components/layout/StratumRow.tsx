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
      background: '{colors.spark/3}',
    },
  })
  .variant({
    prop: 'kind',
    variants: {
      base: {
        background: '{colors.ember/4}',
      },
      variants: { background: '{colors.ember/8}' },
      states: { background: '{colors.ember/12}' },
      groups: {
        background: '{colors.ember/16}',
      },
      terminal: {
        borderColor: 'primary',
        background: '{colors.ember/30}',
      },
    },
  })
  .groups({ space: true, surface: true, arrange: true })
  .asElement('div');
