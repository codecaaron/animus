import { animus } from '@animus/props';

export const Anchor = animus
  .styles({
    display: 'inline-block',
    color: 'primary',
    '&:hover': {
      textDecoration: 'none',
      color: 'primary-hover',
    },
  })
  .states({
    active: {
      fontWeight: 700,
    },
  })
  .systemProps({
    layout: true,
    space: true,
  })
  .asComponent('a');
