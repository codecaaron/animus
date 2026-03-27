## Why

Any component with two or more variant axes (size × visual style, layout × density) encounters the specificity matrix problem: certain combinations need style overrides that neither individual variant can express alone. Ghost + xs needs zero padding, but ghost + lg needs padding — there's no way to express this today without leaking combination logic into consumer code. Compound variants are a well-established pattern (Stitches, CVA) and a prerequisite for production design system components.

## What Changes

- **New `.compound()` builder method** between `.variant()` and `.states()` in the type-state machine chain. Takes a condition object (which variant values must be active) and a styles object (the override CSS). Chainable — multiple `.compound()` calls accumulate.
- **New `@layer compounds`** in the cascade between `variants` and `states`: `@layer global, base, variants, compounds, states, system, custom`. **BREAKING** — existing `@layer` declarations gain a new layer.
- **New `AnimusWithCompounds` class** in the builder chain. Returns `this` from `.compound()` — zero type depth cost, no new generic parameters. Condition keys constrained to accumulated `Variants` at the type level.
- **Rust extraction support** — chain walker recognizes `.compound()`, style evaluator resolves compound styles, CSS generator emits `@layer compounds`, transform emitter includes compounds in `createComponent` config.
- **Runtime compound resolution** — `createComponent` checks compound conditions against current variant prop values, applies matching compound classNames.

## Capabilities

### New Capabilities
- `compound-variants`: The `.compound()` builder method, its type constraints, compound condition matching, `@layer compounds` CSS generation, and runtime class resolution.

### Modified Capabilities
- `builder-chain`: New `AnimusWithCompounds` class between `AnimusWithVariants` and `AnimusWithStates`. Chain ordering enforced by type-state machine.
- `extraction-runtime-shim`: `createComponent` config gains `compounds` array. Runtime iterates compounds, checks condition match, applies classNames.
- `rust-extraction-pipeline`: Chain walker recognizes `.compound()` method calls. Style evaluator processes compound style objects. CSS generator emits `@layer compounds`.
- `vite-extraction-plugin`: Layer declaration updated to include `compounds`.

## Impact

- **packages/system/src/Animus.ts** — New `AnimusWithCompounds` class, `.compound()` method on `AnimusWithVariants`, chain rewiring
- **packages/system/src/types/config.ts** — `CompoundEntry` type definition
- **packages/system/src/runtime/index.ts** — Compound condition matching in `createComponent`
- **packages/system/__tests__/types.test-d.tsx** — Type regression tests for compound conditions
- **packages/extract/src/chain_walker.rs** — Recognize `.compound()` in chain walking
- **packages/extract/src/style_evaluator.rs** — Evaluate compound style objects
- **packages/extract/src/css_generator.rs** — Emit `@layer compounds` with compound rules
- **packages/extract/src/transform_emitter.rs** — Include compounds in replacement config
- **packages/vite-plugin/src/index.ts** — Update layer declaration string
- **Cascade contract** — All existing CSS gains a new layer in the declaration. Existing styles unaffected (new layer is empty until used).
