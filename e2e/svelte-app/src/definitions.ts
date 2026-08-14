// Extraction-only system binding (openspec: svelte-extraction-binding).
// The configured system is evaluated by the extraction loader alone; the
// application module graph sees only its type. Successful strict extraction
// replaces every chain below before TypeScript erasure removes the type-only
// import and this declaration — which is why this pattern REQUIRES
// `strict: true`: a withheld replacement would otherwise serve raw code
// whose `ds` binding no longer exists at runtime.
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
