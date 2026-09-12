import { kitSizes } from '@animus-ui/test-ds';

import { ds } from '../ds';

// KitSized and InlineSized must declare identical option maps:
// assertVariantDeclarationParity pins per-class equality between them.
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
