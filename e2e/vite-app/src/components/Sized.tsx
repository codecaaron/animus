import { kitSizes } from '@animus-ui/test-ds';

import { ds } from '../ds';

// Binding-backed vs inline variant-map siblings (semantic-const-resolution ›
// "Imported variant map across a package boundary"): KitSized references the
// kit's `as const` map through a plain named import; InlineSized authors the
// IDENTICAL map inline. The assert lane (assertVariantDeclarationParity) pins
// per-class declaration equality between the two — base class and every variant
// option class — so any resolver drift between the binding-backed and inline
// paths is a hard STOP.
const sizedBase = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '4px',
  bg: 'surface',
  color: 'text',
} as const;

export const KitSized = ds
  .styles(sizedBase)
  .variant({ prop: 'size', variants: kitSizes })
  .asElement('span');

export const InlineSized = ds
  .styles(sizedBase)
  .variant({
    prop: 'size',
    variants: {
      sm: { fontSize: 14, px: 8, py: 4 },
      md: { fontSize: 16, px: 16, py: 8 },
      lg: { fontSize: 20, px: 24, py: 12 },
    },
  })
  .asElement('span');
