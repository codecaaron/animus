// `ds` here is type-only and has no runtime binding: extraction must replace
// every chain below, so this pattern requires `strict: true`.
import type { ds as configuredSystem } from './ds';

declare const ds: typeof configuredSystem;

export const literalNotice = ds
  .styles({
    display: 'block',
  })
  .variant({
    prop: 'tone',
    defaultVariant: 'quiet',
    variants: {
      quiet: { borderStyle: 'solid' },
      loud: { borderStyle: 'double' },
    },
  })
  .asClass();

export const dynamicNotice = ds
  .styles({
    display: 'flex',
  })
  .variant({
    prop: 'tone',
    defaultVariant: 'calm',
    variants: {
      calm: { outlineStyle: 'solid' },
      urgent: { outlineStyle: 'dashed' },
    },
  })
  .props({
    gap: { property: 'gap' },
    offset: { property: 'marginLeft' },
  })
  .asClass();
