import { ds } from '../system';

// Condition-block fixtures (modern-css-surface inc 03 + 05). RAW at-rule keys
// need no registration, so they emit through any extracting system — one per
// envelope scenario family: named container (+ container-relative unit),
// media-feature (non-breakpoint), and @supports, plus (inc 05) a stacked
// condition, a selector nested inside a condition, and a responsive value map
// inside a condition. Each must emit inside the owning @layer block, wrapping
// the class selector (Guardrail G2).
export const Card = ds
  .styles({
    bg: 'surface',
    p: 16,
    borderRadius: '8px',
    color: 'text',
    // Container establishment (design D7): plain pass-through declarations,
    // emitted verbatim in the base rule (`container-type` / `container-name`).
    containerType: 'inline-size',
    containerName: 'card',
    '@container card (min-width: 400px)': {
      p: 24,
      width: '50cqw',
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
    '@supports (display: grid)': {
      display: 'grid',
      // inc 05: nested selector + stacked condition inside a condition
      // block. The RESOLVER handles both now; the TYPE surface catches up
      // in inc 04 (D9 recursive arms) — inc 04 MUST remove this
      // suppression (excess-property checking reports once per literal,
      // so this one directive covers both nested keys below).
      // @ts-expect-error -- nested block keys typed by inc 04
      '&:focus-visible': { outline: '2px solid' },
      // inc 05: stacked conditions (container nests inside supports).
      '@container card (min-width: 600px)': { gap: '2cqi' },
      // inc 05: responsive value map inside a condition block (scale keys).
      fontSize: { _: 14, sm: 16 },
    },
  })
  .system({ m: true, mx: true, my: true })
  .asElement('div');
