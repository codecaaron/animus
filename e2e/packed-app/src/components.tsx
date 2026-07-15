import { animations, ds } from './ds';

export const Box = ds
  .styles({
    display: 'flex',
    position: 'relative',
  })
  .system({ space: true, layout: true, positioning: true })
  .asElement('div');

export const Stack = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  })
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
    prop: 'size',
    variants: {
      small: { fontSize: 14, px: 8, py: 4 },
      medium: { fontSize: 16, px: 16, py: 8 },
      large: { fontSize: 24, px: 24, py: 16 },
    },
  })
  .variant({
    prop: 'intent',
    variants: {
      primary: { bg: 'primary', color: 'background' },
      secondary: { bg: 'secondary', color: 'background' },
      danger: { bg: 'danger', color: 'background' },
    },
  })
  .states({
    hover: { opacity: '0.85' },
    disabled: { opacity: '0.5', cursor: 'not-allowed' },
  })
  .asElement('button');

export const Pulse = ds
  .styles({
    bg: 'primary',
    color: 'text',
    px: 16,
    py: 8,
    borderRadius: '4px',
    animationName: animations.pulse,
    animationDuration: '2s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  })
  .asElement('span');

export const Fade = ds
  .styles({
    bg: 'surface',
    color: 'text',
    px: 16,
    py: 8,
    borderRadius: '4px',
    animationName: animations.fadeIn,
    animationDuration: '1s',
    animationFillMode: 'forwards',
  })
  .asElement('span');
