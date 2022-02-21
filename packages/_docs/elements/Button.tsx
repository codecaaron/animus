import { animus, Arg } from '@animus-ui/core';

export const ButtonContainer = animus
  .styles({
    p: 0,
    pb: 2,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 0,
    borderColor: 'transparent',
    borderRadius: 4,
    boxShadow: 'none',
    fontWeight: 700,
    lineHeight: 'title',
    letterSpacing: '1px',
    cursor: 'pointer',
    position: 'relative',
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
          backgroundImage: ({ colors, gradients }) =>
            `linear-gradient(90deg, ${colors['background-current']} 0%, ${colors['background-current']} 100%), ${gradients.flowX}`,
          backgroundRepeat: 'no-repeat, repeat',
          backgroundSize: 'calc(100% - 4px) calc(100% - 4px), 300px 100px',
          backgroundPosition: '50% 50%, 0px 0%',
          transition: 'bg',
          inset: 0,
          bg: 'background-current',
          zIndex: 0,
        },
        '&:hover:before': {
          backgroundPosition: '50% 50%, -100px 0%',
        },
        '&:active:hover:before': {
          backgroundPosition: '50% 50%, -400px 0%',
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
