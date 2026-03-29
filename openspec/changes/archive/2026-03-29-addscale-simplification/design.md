## Context

The theme builder (`createTheme`) is a compile-time authoring API. Its sole purpose is producing a manifest (tokenMap, variableMap, CSS variable declarations) consumed by the Rust extraction pipeline. The theme object itself is discarded after `build()` — it never reaches the browser or the Rust crate as a structured object.

Currently, `addScale(name, factory)` and `createScaleVariables(name)` are separate methods with different call patterns. The builder chain interleaves collection and resolution — `addColors` stores AND serializes, `createScaleVariables` transforms values in-place during chaining. This creates an implicit ordering dependency without making it explicit in the API.

The builder chain is a cascade: each step can reference what came before. Colors are declared first, color modes reference palette colors, scales can reference emitted colors and other emitted scales. This cascade is the same principle that governs the CSS layer order (`@layer base < variants < compounds < states`), applied at the configuration level.

### Current Implementation

- `ThemeBuilder.addScale(key, createScale)` — calls `flattenScale(createScale(this.#theme))`, stores result in `this.#theme[key]`
- `ThemeBuilder.createScaleVariables(key)` — calls `serializeTokens()` which converts values to `var()` refs, stores originals in `_tokens[key]`, declarations in `_variables[key]`
- `ThemeBuilder.build()` — calls `assembleManifest()` which iterates all theme keys, flattens tokens, builds tokenMap/variableMap

### Consumers

- **Showcase** (`ds.ts`): 13 `addScale` calls (all static factories), 1 `createScaleVariables('sizes')`
- **Docs** (`_docs/theme.ts`): uses factory param for derived shadows — `({ colors }) => ({...})`. Internal only.
- **Tests** (`theme.test.ts`, `test-system.ts`): exercise both patterns

## Goals / Non-Goals

**Goals:**

- Unify `addScale` + `createScaleVariables` into a single method call
- Remove factory ceremony — static values don't need callback wrappers
- Enable cross-scale references via token ref syntax (`{colors.text}`) instead of JS interpolation
- Type-safe token refs constrained to emitted scales via template literal types
- Preserve identical manifest output — no downstream changes to Rust pipeline

**Non-Goals:**

- Refactoring `build()` internals into a multi-phase pipeline (correct architecture, separate change)
- Changing how `addColors` or `addColorModes` work (they're fine as-is)
- Adding token ref resolution to the Rust extraction pipeline (it already has it for component styles)
- Template literal type for key-level validation (`{colors.text}` where `text` must be `keyof T['colors']`) — fast-follow, not blocking

## Decisions

### D1: Config object shape — `{ name, values, emit? }`

Single config object matching the pattern used by `.variant({ prop, variants, defaultVariant })`.

**Alternatives considered:**
- `addScale(name, values)` — 2-arg positional. Simpler but no place for `emit` flag without a third arg.
- `addScale(name, { values, emit })` — name stays positional. Doesn't match the config-object pattern used elsewhere.

**Rationale:** Config objects are self-documenting and extensible. Every key is named. Consistent with variant/compound APIs.

### D2: `emit` defaults to `false`

12 of 13 showcase scales don't emit CSS variables. Only `sizes` does. Defaulting to `true` would emit variables for scales like `borders: { 1: '1px solid ' }` which makes no sense as a CSS variable.

**Alternatives considered:**
- `emit: true` by default — "it just works" but creates unnecessary CSS variables and bloats the stylesheet.
- No `emit` flag, always emit — simplest code path but wrong for scales used as lookup tables.

**Rationale:** Opt-in matches the current behavior (explicit `createScaleVariables` call). Colors auto-emit because they always need variables for color mode switching. Scales are different — many are just value maps for prop resolution.

### D3: Factory form eliminated entirely

The factory `(theme) => ({...})` is used in exactly one internal consumer (`_docs/theme.ts`) for derived shadows. Token ref syntax is strictly superior:

| | Factory | Token ref |
|--|---------|-----------|
| Cross-scale ref | `({ colors }) => ({ glow: \`0 0 12px \${colors.text}\` })` | `{ glow: '0 0 12px {colors.text}' }` |
| Color mode | Bakes raw value — `#1a1a1a` | Preserves `var()` — responds to mode changes |
| Type safety | Return type inference | Template literal + scale key constraint |

**Rationale:** No overload, no `addDerivedScale`. One method, one shape. Token refs are the mechanism for cross-scale references at every level of the system.

### D4: Token refs constrained to emitted scales only

`{scale.key}` resolves to `var(--scale-key)`. If the scale wasn't emitted, there's no CSS variable to reference. Allowing refs to non-emitted scales would produce invalid CSS.

This also preserves the mental model of the inheritance chain: you can see which scales are "public" (emitted, referenceable) vs "private" (lookup-only). The type system enforces this via template literal types constrained to `keyof EmittedScales<T>`.

**Rationale:** Refs point to variables. No variable, no ref. Consistent mental model across theme and component layers.

### D5: Resolution happens at `build()` time

Token refs in scale values are resolved during `build()` by looking up the referenced value in the already-processed theme. The builder chain's sequential ordering guarantees that referenced scales have already been processed by the time they're used.

This is separate from the Rust pipeline's token ref resolution (which handles component-level refs like `bg: '{colors.primary/40}'`). Two legitimate resolution sites, two different scopes: theme→theme vs component→theme.

**Alternatives considered:**
- Resolution in Rust — would require Rust to understand theme-internal refs in CSS variable declarations. Spreads logic across languages.
- Resolution during `addScale()` — couples collection and resolution. Prevents future refactoring to a pipeline model.

**Rationale:** `build()` has the complete theme state. Resolution is a single pass over all values. Clean separation: collection happens during chaining, resolution happens at build.

## Risks / Trade-offs

- **[Breaking change]** → `addScale` signature changes. Migration is mechanical but touches every `addScale` call. Mitigated: only internal consumers (showcase, _docs, tests). No published API yet.
- **[Token ref resolution ordering]** → A scale value referencing a scale declared LATER in the chain would fail. Mitigated: `build()` resolves after all scales are collected. Chain order determines declaration order, not resolution order.
- **[Template literal type complexity]** → Deep template literal types can cause TSC slowdowns. Mitigated: start with scale-name-level validation only. Key-level validation deferred.
