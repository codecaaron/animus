import { animus } from '@animus/props';

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
  .systemProps({
    layout: true,
    space: true,
  })
  .asComponent('a');
