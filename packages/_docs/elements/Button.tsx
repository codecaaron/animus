import { animus, Arg } from '@animus-ui/core';

export const ButtonContainer = animus
  .styles({
    p: 0,
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
    gradient: 'flowX',
    backgroundSize: '300px 100%',
    backgroundPosition: '0% 0%',
    '&:hover': {
      backgroundPosition: '-100px 0%',
    },
    '&:active:hover': {
      backgroundPosition: '-400px 0%',
    },
  })
  .variant({
    variants: {
      fill: {},
      stroke: {
        '&:before': {
          content: '""',
          position: 'absolute',
          inset: '2px',
          bg: 'background-current',
          zIndex: 0,
          borderRadius: 2,
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
        lineHeight: 'title',
        minHeight: 28,
        minWidth: 60,
      },
      lg: {
        fontSize: 22,
        px: 32,
        lineHeight: 'title',
        minHeight: 48,
        minWidth: 100,
        backgroundSize: '500px 100%',
      },
    },
  })
  .asComponent('button');

const ButtonForeground = animus
  .variant({
    prop: 'size',
    variants: {
      sm: {
        fontSize: 14,
        lineHeight: 'title',
        px: 8,
        minHeight: 28,
        minWidth: 60,
      },
      lg: {
        fontSize: 22,
        lineHeight: 'title',
        px: 32,
        minHeight: 48,
        minWidth: 100,
      },
    },
  })
  .states({
    stroke: {
      position: 'relative',
      zIndex: 1,
      size: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
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
  })
  .asComponent('span');

export const Button = ({
  children,
  variant = 'fill',
  size = 'sm',
  ...rest
}: Arg<typeof ButtonContainer>) => {
  if (variant === 'stroke') {
    return (
      <ButtonContainer variant={variant} {...rest}>
        <ButtonForeground size={size} stroke>
          {children}
        </ButtonForeground>
      </ButtonContainer>
    );
  }
  return (
    <ButtonContainer variant={variant} size={size} {...rest}>
      {children}
    </ButtonContainer>
  );
};
