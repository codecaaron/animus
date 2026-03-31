## Why

After type narrowing improvements, color-scale-bound properties (`bg`, `color`, `borderColor`, `fill`, `stroke`) only accept scale keys from `Theme['colors']`. This is correct for most scales, but colors are special — they compose (opacity, mixing, gradients) in ways that spacing or typography scales don't. The Rust extraction pipeline already supports `{scale.path}` and `{scale.path/alpha}` token reference syntax, resolving them to `var()` or `color-mix()`. But the TypeScript type system rejects these strings because they don't match any color scale key.

## What Changes

- Add a `ColorTokenRef` template literal type that accepts strings containing `{colors.X}` and `{colors.X/alpha}` patterns
- Union `ColorTokenRef` into `ThemedScaleValue` and `ScaleValue` when the prop's scale is `'colors'`
- Type assertions for token ref acceptance on color props and rejection on non-color props
- Revert StratumRow workaround: `bg` with token refs instead of `background` passthrough

**Explicit non-changes:**
- Does NOT add token refs to non-color scales (space, shadows, fonts, etc.)
- Does NOT accept raw CSS color functions (rgb, rgba, hsl) — Chakra v3 opened this and it became unmanageable
- Does NOT change the Rust pipeline — `resolve_token_aliases` already handles `{...}` on all values
- Does NOT change runtime behavior — purely type-level

## Capabilities

### New Capabilities
- `color-token-ref-types`: Type-level support for `{colors.X}` and `{colors.X/alpha}` token reference syntax on color-scale-bound properties

### Modified Capabilities
- `token-alias-syntax`: Adding type-level representation for the existing runtime token alias feature, scoped to color properties
- `prop-system`: `ThemedScaleValue` and `ScaleValue` gain color-specific token ref branch

## Impact

- **system/src/types/config.ts**: `ThemedScaleValue` and `ScaleValue` types modified — adds color token ref union when scale is `'colors'`
- **system/__tests__/types.test-d.tsx**: New type assertions for color token ref acceptance/rejection
- **showcase/src/components/layout/StratumRow.tsx**: Revert `background` workaround to `bg` with token refs
- **Rust pipeline**: No changes — verified that scale miss falls through to `resolve_token_aliases`
- **Consumer API**: Purely additive — existing color scale key usage unchanged
