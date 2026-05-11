## Context

System props in Animus resolve their accepted value types through a chain: `Prop` config → `ScaleValue` → `PropertyValues`. When a prop references a theme scale (e.g., `scale: 'space'`), the type narrows to `keyof Theme['space']` plus CSS globals. The `IsEmpty<Scale>` check controls whether `PropertyValues` includes `(string & {}) | 0` — it only does so when the scale has no values, serving as a fallback.

This means any prop bound to a populated scale is strictly typed. There is no per-prop opt-out. The `Prop` interface already supports per-prop modifiers (`negative: boolean`), making `strict: boolean` a natural addition.

The `(string & {})` pattern is the TypeScript standard for "known literal union with arbitrary string escape hatch" — it preserves IntelliSense/typeahead for the known values while accepting any string without error.

## Goals / Non-Goals

**Goals:**
- Add `strict?: boolean` to the `Prop` interface (default: `undefined`, treated as `true`)
- When `strict: false`, the prop type becomes `scaleKeys | NegativeOf<...> | (string & {}) | 0` — scale values provide typeahead, arbitrary CSS strings accepted
- Preserve existing behavior for all props that don't explicitly set `strict: false`
- Work identically for theme-referenced scales, inline MapScale, and inline ArrayScale
- Type-only change — zero runtime, zero extraction impact

**Non-Goals:**
- Scale-level `strict` on `addScale()` config (future consideration — requires type metadata in the theme shape)
- System-wide `strict` default on `createSystem()` (premature — per-prop is the right granularity first)
- Runtime validation of strict mode (extraction is the validation layer, not TypeScript)

## Decisions

### Decision 1: `strict` on `Prop` interface, not on scale or system

**Choice:** Per-prop `strict: false` in the group definition.

**Rationale:** The `Prop` interface is the natural place because:
1. The `Prop` → `ScaleValue` resolution chain already uses `Prop` fields to modify type behavior (`negative: boolean` is the precedent)
2. Different props can reference the same scale with different strictness (e.g., `p` strict, `gap` loose) — prop-level gives this control
3. Scale-level `strict` on `addScale()` would require propagating type metadata through `Theme` which adds complexity to the theme builder's generic chain

**Alternative considered:** `addScale({ strict: false })` — rejected because it couples strictness to the token definition rather than the consumption site. The same scale (`space`) may be consumed strictly by some props and loosely by others. Prop-level is more flexible.

### Decision 2: Check `Config['strict'] extends false` (explicit false), not `Config['strict'] extends boolean`

**Choice:** Only `false` triggers loose mode. `undefined` and `true` both produce strict behavior.

**Rationale:** This ensures backward compatibility — every existing `Prop` has `strict: undefined`, which resolves to strict. You must explicitly opt out. The conditional `Config['strict'] extends false ? true : IsEmpty<Scale>` cleanly gates the `IncludeGlobals` parameter.

### Decision 3: Introduce `StrictOrEmpty` helper type

**Choice:** Extract the strict-vs-empty logic into a named type:

```typescript
type StrictOrEmpty<Config extends Prop, Scale> =
  Config['strict'] extends false ? true : IsEmpty<Scale>;
```

**Rationale:** `ScaleValue` and `ThemedScaleValue` both have the same `IsEmpty<Scale>` check in three places each (theme scale, MapScale, ArrayScale). Replacing all six occurrences with `StrictOrEmpty<Config, Scale>` keeps the logic DRY and the intent readable.

### Decision 4: `(string & {}) | 0` as the loose value, not just `(string & {})`

**Choice:** Include `0` in the loose union (matching the existing `IncludeGlobals = true` behavior).

**Rationale:** `0` is a valid CSS value for most properties (`margin: 0`, `padding: 0`). Without `0`, `p: 0` would require the scale to include a `0` key. Including `0` matches csstype's default `TLength` parameter and the existing loose behavior when scales are empty.

## Risks / Trade-offs

### Risk: Extraction accepts values that TypeScript now allows but can't extract
`strict: false` means TypeScript accepts `p: someVariable` or `p: dynamicString`. Extraction requires static string literals — these would fail silently at build time.

→ **Mitigation:** This is an existing risk for ALL Animus props (even strict ones accept `'inherit'`, which extraction can handle). The extraction pipeline already warns on non-literal values. `strict: false` doesn't make this worse — it just makes the type system more permissive, matching what extraction already handles.

### Risk: `NegateKeys` interaction with `(string & {})`
`NegateKeys` operates on numeric literal types. `(string & {})` passes through `NegateKeys` as `never` (it's not a number). No regression — negative values are only generated from scale keys, not from the loose string type.

→ **Mitigation:** Verify with a type test that `strict: false` + `negative: true` still produces correct negative keys alongside `(string & {})`.

### Risk: ResponsiveProp wrapping with loose values
`Scale<Config, T>` wraps `ScaleValue` in `ResponsiveProp<T>`. With loose types, responsive objects would accept `{ sm: '2.5rem', md: 16 }` — mixing arbitrary strings with scale keys per breakpoint.

→ **Mitigation:** This is the intended behavior. Responsive props should have the same escape hatch as base props. Verify with a type test.

### Risk: Inline scale (`MapScale` / `ArrayScale`) interaction
The `ScaleValue` type has three branches — theme scale, MapScale, ArrayScale. All three use `IsEmpty<Scale>` to gate `PropertyValues`. All three need to be updated to use `StrictOrEmpty<Config, Scale>`.

→ **Mitigation:** Update all three branches consistently. Verify with type tests for each branch.

### Trade-off: No scale-level `strict` (deferred)
Some consumers may want ALL props referencing a scale to be loose (e.g., a `sizes` scale). Per-prop `strict: false` requires annotating each prop individually.

→ **Accepted:** Per-prop is the right starting point. Scale-level `strict` can be added later without breaking changes (it would serve as a default that per-prop overrides).
