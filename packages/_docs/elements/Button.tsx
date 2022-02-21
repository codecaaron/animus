import { animus } from '@animus-ui/core';

export const Button = animus
  .styles({
    border: 0,
    borderColor: 'transparent',
    borderRadius: 4,
    boxShadow: 'none',
    fontWeight: 700,
    lineHeight: 'title',
    letterSpacing: '1px',
    cursor: 'pointer',
    transition: 'bg',
    bg: 'transparent',
    position: 'relative',
    gradient: 'flowBgX',
    backgroundSize: '300px 100%',
    backgroundPosition: '0% 0%',
    '&:hover, &:hover:before': {
      backgroundPosition: '-100px 0%',
    },
    '&:active:hover, &:active:hover:before': {
      backgroundPosition: '-400px 0%',
    },
    '&:before, &:after': {
      backgroundSize: '300px 100%',
      backgroundPosition: '0% 0%',
      zIndex: -2,
      transition: 'bg',
      borderRadius: 'inherit',
      content: '""',
      position: 'absolute',
      bg: 'transparent',
    },
    '&:before': {
      inset: '-1px',
      gradient: 'flowBgX',
    },
    '&:after': {
      inset: 0,
    },
  })
  .variant({
    variants: {
      fill: {
        color: 'background',
        '&:before': {
          inset: 0,
        },
      },
      stroke: {
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        '&:after': {
          bg: 'background-current',
        },
      },
    },
  })
  .variant({
    prop: 'size',
    variants: {
      sm: {
        fontSize: 14,
        px: 8,
        pb: 2,
        minHeight: 28,
        minWidth: 60,
        '&:after': {
          inset: 0,
        },
      },
      lg: {
        fontSize: 22,
        px: 32,
        pb: 2,
        minHeight: 48,
        minWidth: 100,
      },
    },
  })
  .asComponent('button');

Button.defaultProps = {
  size: 'sm',
  variant: 'fill',
};
