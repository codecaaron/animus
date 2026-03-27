## Context

Landscape analysis across Stitches, Panda CSS, Vanilla Extract, StyleX, and Chakra v3 to identify patterns worth adopting, patterns our architecture uniquely enables, and patterns to defer.

## Frameworks Analyzed

- **Stitches** (archived 2023) — `css()`, `utils`, responsive variants, `$token`, `compoundVariants`
- **Panda CSS** — patterns (stack/grid), `cva`/`sva` recipes, slot recipes, conditions, container queries
- **Vanilla Extract** — `recipe()`, sprinkles, `createThemeContract`, `@layer` support, `composeStyles`
- **StyleX** — `stylex.create/props`, `defineVars`, deterministic merge, `stylex.when.*`, `@property`
- **Chakra v3** — `defineSlotRecipe`, `colorPalette`, semantic tokens, text/layer/animation styles

## What Animus Already Has (parity or better)

| Feature | Us | Them |
|---|---|---|
| Compound variants + array conditions | `.compound()` with arrays | Panda `cva`, Stitches (single-value only) |
| Default variants | `defaultVariant` per variant config | All frameworks |
| Theme as CSS variables | `createTheme` + module augmentation | All frameworks |
| Custom prop shorthands | `withProperties()` + groups + transforms | Stitches `utils`, Panda conditions |
| Static extraction | Rust crate, zero-runtime | Panda, VE, StyleX |
| `@layer` cascade contract | 7 layers, builder-chain-ordered | Panda (5 layers), VE (manual) |
| Token alias syntax | `{scale.key}` → `var()` | Stitches `$token`, Panda `{path}` |
| Responsive prop syntax | Array + object on system props | All frameworks |
| Extension/composition | `.asComponent()` with provenance | Stitches `styled(Base)`, VE arrays |
| Negative scale values | `negative: true` flag (just shipped) | Chakra, styled-system |

## What Our Architecture Uniquely Enables

### 1. Cascade-ordered slot recipes
Panda/Chakra slot recipes have no @layer ordering between slots. In Animus, each slot is a builder chain with its own @layer position. A parent slot's `.variant()` styles (`@layer variants`) predictably override a child slot's `.styles()` (`@layer base`). Architecturally impossible without @layer semantics.

### 2. Type-state enforced composition
The builder chain IS the cascade contract. `.variant()` after `.props()` is a compile error. StyleX has `StyleXStyles<T>` for property restriction, but not ordering enforcement.

### 3. Provenance-tracked extension
`.asComponent(Base)` emits parent and child to the same @layer, source-ordered. Override is structural, not merge-order-dependent.

### 4. Finite style machine completeness
ENUMERATE → TRANSACT → RECONCILE → SNOWFLAKE. No other framework can prove every well-typed prop value produces visible CSS.

## Active Proposals (own spike)

### `css()` standalone utility
DX gap — every competitor has an escape hatch for one-off styles. Additive method on system build result: `ds.css({ display: 'flex', p: 8 })` → className. Extracts to `@layer base`. See `openspec/changes/css-utility/`.

### Slot recipes
Multi-part component pattern. API-first decision — how the consumer writes it matters more than implementation. See `openspec/changes/slot-recipes/` (explore).

## Deferred (worth considering later)

### colorPalette virtual token rebinding
Chakra v3's solution to color × variant combinatorial explosion. One component definition references `colorPalette.*`, `<Button colorPalette="red">` rebinds to `red.*` via CSS variable scoping. Aligns with existing `colorScheme-primitive` proposal. Worth exploring after slot recipes.

### Text/layer style presets
Named style bundles at the system level: `textStyle="heading.xl"`, `layerStyle="card"`. Consumed as props on any component. Extractable as static class references. API question: `.withPresets()` on system builder.

### Container queries
Panda's `@/sm` and `@name/sm` syntax. Future of responsive design. Would need responsive syntax extension + Rust `@container` emission.

### `@property` typed CSS variables
StyleX's typed var declarations enable CSS transitions on custom properties. Low priority — niche use case.

## Iceboxed

### Responsive variant switching
Variant PROP accepting responsive syntax: `size={{ _: 'sm', md: 'lg' }}`. Variant style VALUES already support responsive — the gap is narrow. Complexity cost (type widening, breakpoint flattening, media-queried variant classes) outweighs benefit. Defer.

### Deterministic merge (StyleX model)
Fundamentally different philosophy — "last applied wins" at call site vs our cascade-based ordering. Not compatible with our @layer approach. Not a gap.

### Atomic CSS dedup (StyleX content-addressed)
Our per-component class naming is intentional for debuggability. Not a gap.

### Layout patterns (Panda stack/grid/center)
Component-level abstractions, not system-level. Users build these with our system. The showcase already has Stack, Row, etc.
