import { ds } from '../system';

export const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    fontWeight: '600',
    cursor: 'pointer',
    border: 'none',
    lineHeight: '1',
  })
  .variant({
    prop: 'variant',
    variants: {
      primary: { bg: 'primary', color: 'background' },
      secondary: { bg: 'secondary', color: 'background' },
      ghost: { bg: 'transparent', color: 'text' },
    },
  })
  .system({ px: true, py: true, fontSize: true })
  .asElement('button');
