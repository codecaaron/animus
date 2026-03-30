import { ds } from '../test-system';

export const ButtonContainer = ds
  .styles({
    p: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 4,
    boxShadow: 'none',
    fontWeight: 700,
    lineHeight: 'title',
    letterSpacing: '1px',
    cursor: 'pointer',
    position: 'relative',
    userSelect: 'none',
  })
  .variant({
    variants: {
      fill: {
        color: 'background',
        transition: 'bg',
        bg: 'transparent',
        gradient: 'flowX',
        backgroundSize: '300px 100%',
        backgroundPosition: '0% 0%',
        '&:hover': {
          backgroundPosition: '-100px 0%',
        },
        '&:hover, &:focus-visible': {
          outlineColor: 'primary',
        },
      },
      stroke: {
        '&:before': {
          content: '""',
          position: 'absolute',
          borderRadius: 4,
        },
      },
    },
  })
  .asElement('button');

const ButtonForeground = ds
  .variant({
    prop: 'size',
    variants: {
      sm: {
        fontSize: 14,
        lineHeight: '26px',
        px: 8,
        pb: 2,
        minHeight: 28,
        minWidth: 60,
      },
      lg: {
        fontSize: 22,
        lineHeight: '48px',
        px: 32,
        pb: 2,
        minHeight: 48,
        minWidth: 100,
      },
    },
  })
  .variant({
    variants: {
      fill: {},
      stroke: {
        userSelect: 'none',
        position: 'relative',
        zIndex: 1,
      },
    },
  })
  .asElement('span');
