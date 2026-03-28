import { ds } from '../../ds';

export const Button = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    fontFamily: 'mono',
    fontWeight: 500,
    lineHeight: 'tight',
    textDecoration: 'none',
    transition:
      'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, outline-color 0.15s ease, transform 0.1s ease',
    border: 'none',
    bg: 'transparent',
    outline: 'none',
    '&:disabled': {
      opacity: '0.4',
      pointerEvents: 'none',
      cursor: 'default',
    },
    '&[data-state="disabled"]': {
      opacity: '0.4',
      pointerEvents: 'none',
      cursor: 'default',
    },
    '&:focus-visible': {
      outline: '2px solid {colors.scheme-300}',
      outlineOffset: '2px',
    },
    '&[data-state="focus"]': {
      outline: '2px solid {colors.scheme-300}',
      outlineOffset: '2px',
    },
    '&:active:not(:disabled)': { transform: 'scale(0.98)' },
    '&[data-state="active"]': { transform: 'scale(0.98)' },
  })
  .variant({
    prop: 'color',
    variants: {
      primary: {},
      secondary: {
        '--color-scheme-50': '{colors.bg}',
        '--color-scheme-100': '{colors.bg-muted}',
        '--color-scheme-200': '{colors.text-muted}',
        '--color-scheme-300': '{colors.text-muted}',
        '--color-scheme-400': '{colors.text}',
        '--color-scheme-500': '{colors.bg-inverse/85}',
        '--color-scheme-600': '{colors.bg-inverse/92}',
        '--color-scheme-700': '{colors.bg-inverse/70}',
        '--color-scheme-800': '{colors.text/12}',
        '--color-scheme-900': '{colors.text/6}',
        '--color-scheme-950': '{colors.bg}',
      },
      success: {
        '--color-scheme-50': '{colors.forest-50}',
        '--color-scheme-100': '{colors.forest-100}',
        '--color-scheme-200': '{colors.forest-200}',
        '--color-scheme-300': '{colors.forest-300}',
        '--color-scheme-400': '{colors.forest-400}',
        '--color-scheme-500': '{colors.forest-500}',
        '--color-scheme-600': '{colors.forest-600}',
        '--color-scheme-700': '{colors.forest-700}',
        '--color-scheme-800': '{colors.forest-800}',
        '--color-scheme-900': '{colors.forest-900}',
        '--color-scheme-950': '{colors.forest-950}',
      },
      warning: {
        '--color-scheme-50': '{colors.gold-50}',
        '--color-scheme-100': '{colors.gold-100}',
        '--color-scheme-200': '{colors.gold-200}',
        '--color-scheme-300': '{colors.gold-300}',
        '--color-scheme-400': '{colors.gold-400}',
        '--color-scheme-500': '{colors.gold-500}',
        '--color-scheme-600': '{colors.gold-600}',
        '--color-scheme-700': '{colors.gold-700}',
        '--color-scheme-800': '{colors.gold-800}',
        '--color-scheme-900': '{colors.gold-900}',
        '--color-scheme-950': '{colors.gold-950}',
      },
      danger: {
        '--color-scheme-50': '{colors.fire-50}',
        '--color-scheme-100': '{colors.fire-100}',
        '--color-scheme-200': '{colors.fire-200}',
        '--color-scheme-300': '{colors.fire-300}',
        '--color-scheme-400': '{colors.fire-400}',
        '--color-scheme-500': '{colors.fire-600}',
        '--color-scheme-600': '{colors.fire-700}',
        '--color-scheme-700': '{colors.fire-800}',
        '--color-scheme-800': '{colors.fire-900}',
        '--color-scheme-900': '{colors.fire-950}',
        '--color-scheme-950': '{colors.gray-950}',
      },
    },
    defaultVariant: 'primary',
  })
  .variant({
    prop: 'kind',
    variants: {
      fill: {
        bg: 'scheme-500',
        color: 'scheme-50',
        '&:hover:not(:disabled)': { bg: 'scheme-400' },
        '&[data-state="hover"]': { bg: 'scheme-400' },
      },
      outline: {
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'scheme-400',
        color: 'scheme-400',
        '&:hover:not(:disabled)': {
          bg: 'scheme-800',
          borderColor: 'scheme-300',
          color: 'scheme-300',
        },
        '&[data-state="hover"]': {
          bg: 'scheme-800',
          borderColor: 'scheme-300',
          color: 'scheme-300',
        },
      },
      ghost: {
        color: 'scheme-400',
        '&:hover:not(:disabled)': {
          bg: 'scheme-800',
          color: 'scheme-300',
        },
        '&[data-state="hover"]': {
          bg: 'scheme-800',
          color: 'scheme-300',
        },
      },
      subtle: {
        bg: 'scheme-800',
        color: 'scheme-200',
        '&:hover:not(:disabled)': { bg: 'scheme-700' },
        '&[data-state="hover"]': { bg: 'scheme-700' },
      },
    },
    defaultVariant: 'fill',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { px: 8, py: 4, fontSize: 12 },
      md: { px: 16, py: 8, fontSize: 14 },
      lg: { px: 24, py: 12, fontSize: 16 },
    },
    defaultVariant: 'md',
  })
  .groups({ space: true })
  .asElement('button');
