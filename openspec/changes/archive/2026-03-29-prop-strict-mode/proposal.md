## Why

System props bound to scales currently enforce strict typing — when a scale has values, only those values (plus CSS globals like `inherit`) are accepted. There is no escape hatch for one-off values like `'2.5rem'` without resorting to inline `style` or casting. Adding `strict: false` to the `Prop` config would widen the type to `scaleKeys | (string & {})`, preserving typeahead for scale values while accepting arbitrary CSS strings. This is the type-level equivalent of the pattern used by csstype, Chakra, and Stitches for "known values with escape hatch."

## What Changes

- Add optional `strict?: boolean` field to the `Prop` interface in `types/config.ts`
- Modify `ScaleValue` and `ThemedScaleValue` type utilities to check `Config['strict']` — when explicitly `false`, include `(string & {}) | 0` in the value union regardless of whether the scale is empty
- No runtime changes — `strict` is a type-only concern; the runtime parser already accepts any value
- No extraction changes — extraction operates on static string literals at build time, independent of TypeScript prop types
- Default behavior is unchanged: `strict` is `undefined` (treated as `true`), preserving current narrow typing

## Capabilities

### New Capabilities
- `prop-strict-mode`: Per-prop `strict: false` option that widens scale-bound types from `scaleKeys | CSSGlobals` to `scaleKeys | (string & {})`, enabling arbitrary CSS value escape hatches with preserved typeahead

### Modified Capabilities

## Impact

- `packages/system/src/types/config.ts` — `Prop` interface, `ScaleValue`, `ThemedScaleValue` types
- `packages/system/src/groups/index.ts` — prop definitions can opt into `strict: false` (no changes required for default strict behavior)
- `packages/system/__tests__/types.test-d.tsx` — new type assertions for strict/loose behavior
- `packages/system/__tests__/test-system.ts` — may need scale values for testing
- Zero runtime impact, zero extraction impact, zero breaking changes
