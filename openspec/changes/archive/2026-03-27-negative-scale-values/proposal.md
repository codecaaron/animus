## Context

Scale-backed props with numeric keys (e.g. `m={8}` looking up index `8` in the space scale) currently reject negative values at the type level. If the space scale defines keys `0 | 4 | 8 | 16`, writing `m={-8}` is a TypeScript error because `-8` is not in the union.

Negative margins are legitimate CSS — pull elements, overlap, negative offsets. Every comparable system (Chakra, styled-system, Theme UI) supports negative scale values for margin and positioning props. This is a parity gap.

## Goals / Non-Goals

**Goals:**
- Type-safe negative scale values for margin and positioning props
- Runtime scale resolution handles negative numbers (abs for lookup, negate result)
- Extraction pipeline handles negative numbers identically
- Opt-in per prop via `negative: true` flag — only props where CSS supports negation

**Non-Goals:**
- Negative padding, gap, border-width, or other inherently non-negative CSS properties
- Negative string scale keys (only numeric keys are negated)
- Changes to core package types (core retains its own type path)

## Decisions

### 1. `negative` flag on Prop interface

```ts
export interface Prop extends BaseProperty {
  scale?: string | MapScale | ArrayScale;
  negative?: boolean;
  // ...
}
```

Declarative opt-in. The prop definition says whether it supports negation. Only margin and positioning directionals set this flag.

**Why a flag, not a transform?** Negation is a type-level concern (which values are accepted) AND a runtime concern (how values are resolved). A transform only handles runtime. The flag drives both.

### 2. `NegateKeys<T>` type utility

```ts
type NegateKeys<T> = T extends number
  ? T extends 0 ? never
    : `-${T}` extends `${infer N extends number}` ? N : never
  : never;
```

Uses TypeScript 4.8+ template literal type inference to produce negated numeric literal unions. `NegateKeys<4 | 8 | 16>` = `-4 | -8 | -16`. Excludes 0 (negative zero is meaningless).

Wired into `ScaleValue` and `ThemedScaleValue` via a conditional helper:

```ts
type NegativeOf<Config extends Prop, Keys> =
  Config['negative'] extends true ? NegateKeys<Extract<Keys, number>> : never;
```

### 3. Runtime resolution: abs-lookup-negate

Both TypeScript (`lookupScaleValue`) and Rust (`resolve_value`) use the same algorithm:
1. Detect negative numeric value
2. `abs()` the value for scale lookup
3. If lookup succeeds, negate the resolved CSS value (prepend `-`)
4. String values: `"0.5rem"` → `"-0.5rem"`. Numeric: `8` → `-8`.

### 4. Props that opt in

| Group | Props | Rationale |
|-------|-------|-----------|
| margin | `m`, `mx`, `my`, `mt`, `mb`, `mr`, `ml` | Negative margins are standard CSS |
| positioning | `top`, `right`, `bottom`, `left`, `inset` | Negative offsets are standard CSS |

Props that do NOT opt in: padding, gap, border-width, border-radius, font-size, or any other inherently non-negative CSS property.

## Verification

- Type test: `m={-4}` compiles, `p={-4}` errors, `m={-99}` errors (not in scale)
- Unit test: `lookupScaleValue(-8, 'space', theme)` returns `"-0.5rem"`
- Canary test: extracted CSS contains `margin: -0.5rem` for `m={-8}`
- Full pipeline: `bun run verify` green
