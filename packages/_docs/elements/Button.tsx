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
    gradient: 'flowBgX',
    color: 'transparent',
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
      fill: {
        color: 'background',
      },
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
      size: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      transition: 'bg',
      bg: 'transparent',
      position: 'relative',
      gradient: 'flowBgX',
      color: 'transparent',
      backgroundSize: '300px 100%',
      backgroundPosition: '0% 0%',
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
