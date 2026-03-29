import { compose } from '@animus-ui/system';

import { ds } from '../../ds';

// ─── Slot Definitions ───────────────────────────────────────────
//
// Each slot is an independent Animus component with its own
// cascade layers. The shared `density` variant exists on every
// slot with matching value sets — compose() enforces this at
// the type level.

export const CardRoot = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'mono',
    color: 'text',
    transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
  })
  .variant({
    prop: 'density',
    variants: {
      compact: { p: 12, gap: 4 },
      comfortable: { p: 24, gap: 12 },
    },
    defaultVariant: 'comfortable',
  })
  .variant({
    prop: 'variant',
    variants: {
      elevated: {
        bg: 'surface',
        border: 1,
        borderColor: 'border',
        boxShadow: 'glow-accent',
      },
      outlined: {
        bg: 'transparent',
        border: 1,
        borderColor: 'border',
      },
      ghost: {
        bg: 'transparent',
        border: 1,
        borderColor: 'transparent',
      },
    },
    defaultVariant: 'elevated',
  })
  .asElement('article');

export const CardHeader = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    fontWeight: 500,
    color: 'text',
    letterSpacing: '-0.01em',
  })
  .variant({
    prop: 'density',
    variants: {
      compact: { fontSize: 13, pb: 4 },
      comfortable: { fontSize: 16, pb: 8 },
    },
    defaultVariant: 'comfortable',
  })
  .asElement('header');

export const CardBody = ds
  .styles({
    color: 'text-muted',
    lineHeight: 'relaxed',
  })
  .variant({
    prop: 'density',
    variants: {
      compact: { fontSize: 12 },
      comfortable: { fontSize: 14 },
    },
    defaultVariant: 'comfortable',
  })
  .asElement('div');

export const CardFooter = ds
  .styles({
    display: 'flex',
    alignItems: 'center',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'current-bg',
    opacity: '1',
  })
  .variant({
    prop: 'density',
    variants: {
      compact: { gap: 6, pt: 8, mt: 4, fontSize: 12 },
      comfortable: { gap: 12, pt: 16, mt: 8, fontSize: 13 },
    },
    defaultVariant: 'comfortable',
  })
  .asElement('footer');

// ─── Composed Family ────────────────────────────────────────────

export const Card = compose(
  {
    Root: CardRoot,
    Header: CardHeader,
    Body: CardBody,
    Footer: CardFooter,
  },
  { shared: { density: true } }
);
