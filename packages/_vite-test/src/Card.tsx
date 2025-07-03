import { animus } from '@animus-ui/core';

export const Card = animus
  .styles({
    p: 16,
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    display: 'flex',
    height: '100vh',
    width: '100vw',
    gap: 16,
   m: 16,
  })
  .asElement('div');
