import { ds } from '../ds';

export const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontWeight: 600,
    lineHeight: 'tight',
    transition: 'all 150ms ease',
  })
  .variant({
    prop: 'size',
    variants: {
      small: { fontSize: 14, px: 8, py: 4 },
      medium: { fontSize: 16, px: 16, py: 8 },
      large: { fontSize: 20, px: 24, py: 16, borderRadius: 8 },
    },
  })
  .variant({
    prop: 'intent',
    variants: {
      primary: {
        bg: 'primary',
        color: 'background',
        '&:hover': {
          bg: '{colors.primary/90}',
        },
      },
      secondary: {
        bg: 'secondary',
        color: 'background',
        '&:hover': {
          bg: '{colors.secondary/90}',
        },
      },
      danger: {
        bg: 'danger',
        color: 'background',
        '&:hover': {
          bg: '{colors.danger/90}',
        },
      },
      ghost: {
        bg: 'transparent',
        color: 'text',
        border: '1px solid',
        borderColor: 'border',
      },
    },
  })
  .states({
    hover: { opacity: '0.85', boxShadow: 'sm' },
    disabled: { opacity: '0.5', cursor: 'not-allowed' },
  })
  .asElement('button');
