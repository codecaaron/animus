import { ds } from './ds';

export const Stack = ds
  .styles({ display: 'flex', flexDirection: 'column', gap: 16 })
  .variant({
    prop: 'direction',
    defaultVariant: 'column',
    variants: {
      column: { flexDirection: 'column' },
      row: { flexDirection: 'row', alignItems: 'center' },
    },
  })
  .system({ space: true, layout: true })
  .asElement('div');

export const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
  })
  .variant({
    prop: 'intent',
    defaultVariant: 'primary',
    variants: {
      primary: { bg: 'primary', color: 'background' },
      danger: { bg: 'danger', color: 'background' },
      ghost: { bg: 'surface', color: 'text' },
    },
  })
  .variant({
    prop: 'size',
    defaultVariant: 'medium',
    variants: {
      small: { fontSize: 14, px: 8, py: 4 },
      medium: { fontSize: 16, px: 16, py: 8 },
      large: { fontSize: 24, px: 24, py: 16 },
    },
  })
  .states({ hover: { opacity: '0.85' } })
  .asElement('button');

export const Panel = ds
  .styles({ border: '1px solid', borderColor: 'border', bg: 'surface', p: 24 })
  .variant({
    prop: 'tone',
    defaultVariant: 'neutral',
    variants: { neutral: { color: 'text' }, danger: { color: 'danger' } },
  })
  .asElement('section');
