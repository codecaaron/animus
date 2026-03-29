import { ds } from '../../ds';

export const CascadeLayer = ds
  .styles({
    display: 'flex',
    alignItems: 'baseline',
    gap: 16,
    py: 12,
    px: 16,
    borderLeft: 2,
    borderColor: 'border',
    transition: 'border-color 0.2s ease, background 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
      background: '{colors.text/4}',
    },
  })
  .variant({
    prop: 'depth',
    variants: {
      1: { borderColor: '{colors.text/100}' },
      2: { borderColor: '{colors.text/15}' },
      3: { borderColor: '{colors.text/20}' },
      4: { borderColor: '{colors.text/30}' },
      5: { borderColor: '{colors.text/40}' },
      6: { borderColor: '{colors.text/55}' },
      7: { borderColor: 'primary' },
    },
  })
  .groups({ space: true })
  .asElement('div');
