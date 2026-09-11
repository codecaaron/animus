import { ds } from '../system';

export const Card = ds
  .styles({
    bg: 'surface',
    p: 16,
    borderRadius: '8px',
    color: 'text',
    containerType: 'inline-size',
    containerName: 'card',
    '@container card (min-width: 400px)': {
      p: 24,
      width: '50cqw',
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
    '@supports (display: grid)': {
      display: 'grid',
      '&:focus-visible': { outline: '2px solid' },
      '@container card (min-width: 600px)': {
        gap: '2cqi',
      },
      fontSize: { _: 14, sm: 16 },
    },
  })
  .system({ m: true, mx: true, my: true })
  .asElement('div');
