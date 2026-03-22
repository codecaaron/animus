import { animus } from '@animus-ui/core';

/**
 * Smoke test components — exercises each extraction capability:
 * - Static styles (.styles)
 * - Variants (.variant)
 * - States (.states)
 * - System props (.groups)
 * - Responsive values (object syntax)
 * - Pseudo-selectors
 */

export const Box = animus
  .styles({
    display: 'flex',
    position: 'relative',
  })
  .states({
    fit: { width: 1, height: 1 },
  })
  .groups({
    space: true,
    layout: true,
    color: true,
  })
  .asElement('div');

export const Text = animus
  .styles({
    m: 0,
    fontFamily: 'base',
    lineHeight: 'base',
  })
  .variant({
    prop: 'as',
    variants: {
      h1: { fontSize: 44, fontWeight: 700 },
      h2: { fontSize: 30, fontWeight: 700 },
      p: { fontSize: 16 },
      small: { fontSize: 14 },
    },
  })
  .groups({
    typography: true,
    color: true,
    space: true,
  })
  .asElement('span');

export const Button = animus
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontWeight: 700,
    letterSpacing: '1px',
    px: 16,
    py: 8,
    '&:hover': {
      opacity: 0.9,
    },
  })
  .variant({
    defaultVariant: 'primary',
    variants: {
      primary: {
        bg: 'primary',
        color: 'background',
      },
      secondary: {
        bg: 'secondary',
        color: 'background',
      },
      ghost: {
        bg: 'transparent',
        color: 'text',
        border: 1,
      },
    },
  })
  .states({
    disabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  })
  .asElement('button');

export const FlexBox = animus
  .styles({
    display: 'flex',
  })
  .states({
    center: { alignItems: 'center', justifyContent: 'center' },
    column: { flexDirection: 'column' },
  })
  .groups({
    space: true,
    layout: true,
    flex: true,
  })
  .asElement('div');
