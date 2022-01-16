import { animus } from '@animus-ui/core';

export const Logo = animus
  .styles({
    width: 'max-content',
    fontSize: 26,
    m: 0,
    fontFamily: 'title',
    letterSpacing: '2px',
    background: ({ colors }) =>
      `linear-gradient(to right, ${colors.tertiary} 0%, ${colors.primary} 100%)`,
    backgroundRepeat: 'repeat',
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
