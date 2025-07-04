import { animus } from '@animus-ui/core';

export const Card = animus
  .styles({
    p: 16,
    backgroundColor: 'white',
    borderRadius: '8px',
    alignItems: 'center',
    justifyContent: 'center',
    display: 'flex',
    gap: 16,
    m: 16,
  })
  .states({
    raised: {
      color: 'green',
      border: '2px solid var(--colors-primary)',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    },
  })
  .groups({ space: true, layout: true, color: true, background: true })
  .asElement('div');
