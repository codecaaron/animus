import { Link } from '@syzygos/components';
import { animus } from '@syzygos/core';

export const FlowLink = animus
  .styles({
    fontWeight: 400,
    gradient: 'flowX',
    backgroundSize: '100px',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    transition: 'text',
    textShadow: 'flush',
    fontFamily: 'base',
    letterSpacing: '0.5px',
    position: 'relative',
    top: '2px',
    '&:hover': {
      fontWeight: 700,
      textShadow: 'link-hover',
    },
    '&:active': {
      textShadow: 'link-pressed',
    },
  })
  .states({
    raised: {
      fontWeight: 700,
      textShadow: 'link-raised',
      '&:hover': {
        textShadow: 'link-hover-raised',
      },
    },
    active: {
      fontWeight: 700,
      textShadow: 'link-raised',
    },
  })
  .asComponent(Link);
