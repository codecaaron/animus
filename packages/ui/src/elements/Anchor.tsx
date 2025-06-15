import { animus } from '@syzygos/core';

export const Anchor = animus
  .styles({
    display: 'inline-block',
    '&:hover': {
      textDecoration: 'none',
    },
  })
  .variant({
    variants: {
      ui: {
        color: 'secondary',
        '&:hover': {
          color: 'primary-hover',
        },
      },
      text: {
        color: 'primary',
        textDecoration: 'underline',
        '&:hover': {
          color: 'primary-hover',
        },
      },
    },
  })
  .states({
    active: {
      fontWeight: 600,
    },
  })
  .groups({
    layout: true,
    space: true,
    typography: true,
  })
  .asElement('a');
