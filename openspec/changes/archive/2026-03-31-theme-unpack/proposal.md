## Why

Design system libraries need to ship reusable themes that consumers can customize — keeping the tokens they want, replacing what they don't, and adding new ones — without manually reproducing every token value. Today there is no mechanism for this: a built theme is a sealed object, and consumers who want partial customization have no safe, type-guided entry point.

## What Changes

- **New method `unpack()` on the built theme object** — decomposes a sealed theme into typed raw config pieces (colors, scales, colorModes, breakpoints, contextualVars) that can be directly spread back into `createTheme()` builder calls.
- **New type `UnpackedTheme<T>`** — carries the exact types of each piece so that TypeScript infers the merged shape when consumers spread and extend.
- **Raw config storage during the builder chain** — `addColors`, `addColorModes`, and `addScale` store the original nested config (not just flattened tokens) so `unpack()` can return spreaddable inputs.
- `unpack()` is added as a non-enumerable property on the built theme object, consistent with `manifest` and `serialize()`.

## Capabilities

### New Capabilities

- `theme-unpack`: Decompose a built theme into typed raw config pieces. Enables composition-based theme customization for the DS library → consumer app use case.

### Modified Capabilities

## Impact

- `packages/system/src/theme/createTheme.ts` — add raw config storage and `unpack()` to `.build()`
- `packages/system/src/types/theme.ts` — add `UnpackedTheme<T>` type
- `packages/system/src/index.ts` — export `UnpackedTheme`
- `packages/system/__tests__/theme.test.ts` — new unit tests for round-trip, augment, partial, and type inference cases
- No breaking changes. Existing `manifest` and `serialize()` behavior is unchanged.
