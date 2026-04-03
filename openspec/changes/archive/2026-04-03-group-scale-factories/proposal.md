## Why

Pre-built prop groups (`space`, `color`, `typography`, `border`, `shadows`, etc.) hardcode scale names as string literals. A consumer who names their spacing scale `"sizing"` instead of `"space"` must recreate all ~15 margin/padding entries by hand. The `Prop.scale` field is typed as `string` — no compile-time guarantee that a scale name matches what actually exists in the consumer's augmented `Theme`.

This replaces the archived `2026-03-29-group-scale-factories` proposal, which referenced the deleted `PropertyBuilder` class.

## What Changes

**Step 1: Group factory functions**

Groups that reference a single scale become factory functions parameterized by that scale name:

```ts
// Before — hardcoded
export const shadows = {
  boxShadow: { property: 'boxShadow', scale: 'shadows' },
  shadow:    { property: 'boxShadow', scale: 'shadows' },
  textShadow: { property: 'textShadow', scale: 'shadows' },
} as const;

// After — factory
export function shadowsGroup<S extends string>(scale: S) {
  return {
    boxShadow:  { property: 'boxShadow',  scale } as const,
    shadow:     { property: 'boxShadow',  scale } as const,
    textShadow: { property: 'textShadow', scale } as const,
  } as const;
}

// Backward-compat static export (unchanged consumer API)
export const shadows = shadowsGroup('shadows');
```

Groups that reference multiple scales accept a mapping object:

```ts
export function typographyGroup<
  M extends { fonts: string; fontWeights: string; fontSizes: string; lineHeights: string; letterSpacings: string }
>(scales: M) {
  return {
    fontFamily:    { property: 'fontFamily',    scale: scales.fonts },
    fontWeight:    { property: 'fontWeight',    scale: scales.fontWeights },
    fontSize:      { property: 'fontSize',      scale: scales.fontSizes },
    lineHeight:    { property: 'lineHeight',    scale: scales.lineHeights },
    letterSpacing: { property: 'letterSpacing', scale: scales.letterSpacings },
    // ...rest
  } as const;
}

export const typography = typographyGroup({
  fonts: 'fonts', fontWeights: 'fontWeights', fontSizes: 'fontSizes',
  lineHeights: 'lineHeights', letterSpacings: 'letterSpacings',
});
```

Groups with no scale references (`flex`, `grid`, `background`, `layout`) remain static objects — no factory needed.

**The `as const` return preserves literal scale names** so they flow through `ScaleValue` type machinery and validate correctly against the augmented `Theme` interface.

**Step 2: addGroup scale validation (future, not this change)**

`SystemBuilder.addGroup` gains a `ValidateScales<Conf>` conditional type that emits type errors when any `Prop.scale` value in the group config does not match `keyof TokenScales<Theme>`. This only fires in consumer code after `declare module` augmentation — library-internal defaults are unaffected.

## Scale map

| Group | Scale params |
|-------|-------------|
| `space` | `space` (single) |
| `color` | `{ colors, gradients }` |
| `border` | `{ borders, borderWidths, radii }` |
| `shadows` | `shadows` (single) |
| `typography` | `{ fonts, fontWeights, fontSizes, lineHeights, letterSpacings }` |
| `positioning` | `{ zIndices, opacities }` |
| `transitions` | `transitions` (single) |
| `flex`, `grid`, `background`, `layout` | static (no scales) |

## Capabilities

### New
- `group-scale-factories`: Factory functions for adapting pre-built prop groups to consumer-defined scale names

### Modified
- `prop-system`: Pre-built group static exports redefined as factory invocations with canonical scale names

## Impact

- `packages/system/src/groups/index.ts` — factory functions added, statics become factory invocations
- `packages/system/src/index.ts` — factory functions exported from package
- Type tests — assertions for factory-created groups resolving custom scale names against augmented `Theme`
- Showcase — no change (uses canonical scale names; static exports remain identical)
- Rust pipeline — no change (scale names are strings regardless of origin)
- Consumer API — purely additive; static group objects still work unchanged
