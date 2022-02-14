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
    fontFamily: 'monospace',
    fontWeight: 400,
    letterSpacing: '1px',
    backgroundImage: ({ colors }) =>
      `linear-gradient(90deg, ${colors['pink-600']} 0%, ${colors['purple-600']} 50%, ${colors['pink-600']} 100%)`,
    backgroundSize: '100px',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    transition: 'text',
    textShadow: ({ colors }) => `0em 0em ${colors.text}`,
    '&:hover': {
      fontWeight: 700,
      textShadow: ({ colors }) =>
        `.125em -.08em ${colors.text}, .125em -.08em 1em ${colors.background}`,
    },
  })
  .states({
    raised: {
      fontWeight: 700,
      textShadow: ({ colors }) =>
        `.1em -.075em ${colors.text}, .1em -.075em 0.25em ${colors.background}`,
      '&:hover': {
        textShadow: ({ colors }) =>
          `.2em -.15em ${colors.text}, .2em -.15em 0.25em ${colors.background}`,
      },
    },
    active: {
      fontWeight: 700,
      textShadow: ({ colors }) =>
        `.125em -.08em ${colors.text}, .125em -.08em 0.25em ${colors.background}`,
    },
  })
  .asComponent(Link as any);
