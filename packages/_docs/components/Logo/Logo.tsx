import { animus } from '@animus-ui/core';
import { keyframes } from '@emotion/react';

const slide = keyframes`
 0% {
   background-position: 0%;
 }

 100% {
   background-position: -100%;
 }
`;

export const Logo = animus
  .styles({
    width: 'max-content',
    fontSize: 30,
    m: 0,
    fontFamily: 'title',
    letterSpacing: '2px',
    background: ({ colors }) =>
      `linear-gradient(to right, ${colors.tertiary} 0%, ${colors.primary} 25%, ${colors.tertiary} 50%, ${colors.primary} 75%, ${colors.tertiary} 100%)`,
    backgroundRepeat: 'repeat',
    backgroundSize: '200%',
    backgroundClip: 'text',
    textFillColor: 'transparent' as any,
    animation: `${slide} 10s linear infinite`,
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
