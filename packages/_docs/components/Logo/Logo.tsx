import { animus } from '@animus-ui/core';
import { keyframes } from '@emotion/react';

const slide = keyframes`
  	0% {
    background-size: 300px 100px;
		background-position: 0% 50%;
	}
	100% {
		background-position: 300px 50%;
    background-size: 300px 100px;
	}
`;

export const Logo = animus
  .styles({
    width: 'max-content',
    fontSize: 30,
    m: 0,
    fontFamily: 'title',
    letterSpacing: '2px',
    backgroundImage: ({ colors }) =>
      `linear-gradient(90deg, ${colors.tertiary} 0%, ${colors.primary} 50%, ${colors.tertiary} 100%)`,
    backgroundSize: '300px 100px',
    animation: ` ${slide} 5s linear infinite`,
    backgroundClip: 'text',
    textFillColor: 'transparent' as any,
  })
  .variant({
    variants: {
      hover: {
        transition: '200ms ease-in',
        '&:hover': {
          textShadow:
            '0 0 8px rgb(255 128 191 / 25%), 0 0 8px rgb(149 128 255 / 25%)',
        },
      },
    },
  })
  .groups({ typography: true })
  .props({
    logoSize: {
      property: 'fontSize',
      scale: { sm: 24, md: 34, lg: 64, xxl: 128 },
      variable: '--logo-size',
    },
  })
  .asComponent('h1');
