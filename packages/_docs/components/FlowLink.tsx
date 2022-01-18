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
    fontWeight: 600,
    letterSpacing: '1px',
    transition: 'text-shadow 200ms ease',
    textShadow: ({ colors }) =>
      `2px -2px ${colors.text}, 2px -2px 4px ${colors.background}`,
    backgroundImage: ({ colors }) =>
      `linear-gradient(90deg, ${colors.tertiary} 0%, ${colors.primary} 50%, ${colors.tertiary} 100%)`,
    backgroundSize: '300px 100px',
    animation: ` ${flow} 5s linear infinite`,
    backgroundClip: 'text',
    textFillColor: 'transparent' as any,
  })
  .asComponent(Link as any);
