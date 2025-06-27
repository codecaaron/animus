import { Arg, animus } from '@animus-ui/core';

export const ButtonContainer = animus
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
        '&:active:hover': {
          backgroundPosition: '-400px 0%',
        },
      },
      stroke: {
        '&:before': {
          content: '""',
          position: 'absolute',
          borderRadius: 4,
          gradient: 'flowX',
          backgroundSize: '300px 100px',
          backgroundPosition: '0px 0%',
          transition: 'bg',
          inset: 0,
          bg: 'background-current',
          zIndex: 0,
        },
        '&:after': {
          content: '""',
          inset: 2,
          borderRadius: 2,
          bg: 'background-current',
          zIndex: 0,
          position: 'absolute',
        },
        '&:hover:before': {
          backgroundPosition: '-100px 0%',
        },
        '&:active:hover:before': {
          backgroundPosition: '-400px 0%',
        },
      },
    },
  })
  .asElement('button');

const ButtonForeground = animus
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
        size: 1,
        display: 'inline-block',
        flex: 1,
        transition: 'bg',
        gradient: 'flowX',
        backgroundSize: '300px 100px',
        backgroundPosition: '0px 0%',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        '&:hover': {
          backgroundPosition: '-100px 0%',
        },
        '&:active:hover': {
          backgroundPosition: '-400px 0%',
        },
      },
    },
  })
  .asElement('span');

export const Button = ({
  children,
  variant = 'fill',
  size = 'sm',
  ...rest
}: Arg<typeof ButtonContainer> & Arg<typeof ButtonForeground>) => {
  return (
    <ButtonContainer variant={variant} {...rest}>
      <ButtonForeground variant={variant} size={size}>
        {children}
      </ButtonForeground>
    </ButtonContainer>
  );
};
