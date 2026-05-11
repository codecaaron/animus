## Negative Scale Values — Specification

### Type Layer

**File:** `packages/system/src/types/config.ts`

1. Add `negative?: boolean` to `Prop` interface
2. Add `NegateKeys<T>` utility type — template literal inference for negated numeric unions
3. Add `NegativeOf<Config, Keys>` conditional helper
4. Wire `NegativeOf` into `ScaleValue` and `ThemedScaleValue` theme-scale branches and map-scale branches

**Behavioral contract:**
- `negative: true` + theme scale with numeric keys `K` → accepts `K | NegateKeys<K>`
- `negative: true` + inline MapScale with numeric keys → same
- `negative` unset or false → no change to accepted values
- ArrayScale branch: no negation support (array scales use membership, not key lookup)

### Prop Config Layer

**File:** `packages/system/src/groups/index.ts`

Props with `negative: true`:
- `m`, `mx`, `my`, `mt`, `mb`, `mr`, `ml` (margin group)
- `inset`, `top`, `right`, `bottom`, `left` (positioning group)

All other props: no `negative` flag.

### Runtime Layer

**File:** `packages/core/src/scales/lookupScaleValue.ts`

Algorithm change:
```
if value is negative number:
  lookupVal = Math.abs(value)
  result = scale lookup with lookupVal
  if result is number: return -result
  if result is string: return `-${result}`
else:
  existing behavior unchanged
```

### Extraction Layer

**File:** `packages/extract/src/theme_resolver.rs`

`resolve_value()` changes:
1. Detect negative `Value::Number` → extract absolute value for lookup
2. After scale resolution + optional transform, negate the CSS string output
3. `negate_css_value()` helper: prepend `-`, handle double-negation edge case

`PropConfig` struct: no change needed. The `negative` flag is a TypeScript-only concern — Rust resolves whatever values OXC parsed from source, and negative numbers are valid `Value::Number` values.

### Type Tests

**File:** `packages/system/__tests__/types.test-d.tsx`

Positive assertions:
- `<SpaceOnly m={-4} />` — negative margin from scale compiles
- `<SpaceOnly mt={-8} />` — negative individual margin compiles
- `<SpaceOnly mx={-16} />` — negative axis margin compiles

Negative assertions:
- `<SpaceOnly m={-99} />` — not in negated scale, errors
- `<SpaceOnly p={-4} />` — padding has no negative flag, errors

### Runtime Tests

- `lookupScaleValue(-8, 'space', theme)` returns negated resolved value
- Existing positive lookups unchanged

### Canary Tests

- Component with `m={-8}` extracts to `margin: -0.5rem` (or equivalent)
