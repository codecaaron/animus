import { Link } from '@animus-ui/components';
import { animus } from '@animus-ui/core';
import { keyframes } from '@emotion/react';

export const flow = keyframes`
  	0% {
        background-size: 300px 100px;
        background-position: 0% 50%;
	}
	100% {
        background-position: 300px 50%;
        background-size: 300px 100px;
	}
`;

export const FlowLink = animus
  .styles({
    fontWeight: 400,
    gradient: 'flowX',
    backgroundSize: '100px',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    transition: '100ms linear text-shadow, 100ms ease-in-out transform',
    textShadow: 'flush',
    fontFamily: 'base',
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
  .asComponent(Link as any);
