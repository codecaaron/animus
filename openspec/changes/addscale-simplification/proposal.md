## Why

The current `addScale` API has three sources of friction:

1. **Callback wrapper is ceremony.** Every scale in the showcase is `() => ({...})` — a factory that ignores its parameter. The `(theme) => ...` form exists for derived scales, but no consumer actually uses it. 13 of 13 showcase scales are static.

2. **`createScaleVariables()` is a separate step.** Colors emit CSS variables automatically via `.addColors()`. Scales don't — you must chain `.createScaleVariables('name')` separately. It's easy to forget, and there's no reason scales should behave differently from colors.

3. **Derived scales don't need JS interpolation.** The factory form was used for cross-scale references like `({ colors }) => ({ glow: \`0 0 12px \${colors.text}\` })`. But token ref syntax `{colors.text}` already resolves at build time — and is strictly better because it preserves `var()` indirection (responds to color mode changes), whereas factory interpolation bakes the raw value.

## What Changes

Replace `addScale(name, factory)` with `addScale({ name, values, emit? })` — a single config object matching the pattern used by `.variant()` and `.compound()`.

**Before:**
```ts
createTheme({ breakpoints: {...} })
  .addScale('space', () => ({
    0: '0',
    4: '0.25rem',
    8: '0.5rem',
    16: '1rem',
  }))
  .addScale('sizes', () => ({
    navHeight: '48px',
  }))
  .createScaleVariables('sizes')  // easy to forget, colors don't need this
  .build()
```

**After:**
```ts
createTheme({ breakpoints: {...} })
  .addScale({
    name: 'space',
    values: { 0: '0', 4: '0.25rem', 8: '0.5rem', 16: '1rem' },
  })
  .addScale({
    name: 'sizes',
    emit: true,
    values: { navHeight: '48px', sidebarWidth: '200px' },
  })
  .addScale({
    name: 'shadows',
    values: {
      glow: '0 0 12px {colors.text}',  // token ref — resolves to var(--color-text)
    },
  })
  .build()
```

- Single config object: `{ name, emit?, values }` — same shape as `.variant({ prop, variants, defaultVariant })`
- `emit: true` → generates CSS variables (`--sizes-navHeight`)
- `emit: false` (default) → scale values used for lookup only, no CSS variables
- Token ref syntax `{colors.text}` in scale values resolves at `build()` time — only emitted scales may be referenced
- Factory form eliminated — token refs replace JS interpolation for cross-scale references
- `createScaleVariables()` eliminated — absorbed into `emit: true`

## Impact

- **Theme API:** `addScale` signature changes from `(name, factory)` to `({ name, values, emit? })`. Factory form removed entirely.
- **`createScaleVariables`:** Removed. Absorbed into `emit: true` on addScale config.
- **Existing consumers:** Migration is mechanical — unwrap `() => (...)` to `{ name, values }`. Remove `createScaleVariables` calls. Replace any factory interpolation with token refs.
- **Extraction pipeline:** No Rust changes. Scale values already resolve through the variable map. The change is in the theme builder only.
- **Type inference:** Flat object gives the same type inference as the factory return type. Token refs in values typed via template literal constrained to emitted scales.
- **Theme as manifest generator:** The theme object is a compile-time artifact, discarded after manifest assembly. This change doesn't alter that — it simplifies the authoring API while preserving identical manifest output.

## Resolved Questions

- **Emit default:** `false`. Opt-in per scale. Colors auto-emit; scales don't unless explicitly requested.
- **Factory form:** Eliminated entirely. No `addDerivedScale` needed. Token refs (`{scale.key}`) replace JS interpolation and are strictly better (preserve `var()` indirection, respond to color mode).
- **Token ref scope:** Only emitted scales (those with CSS variables) may be referenced via `{scale.key}`. Enforced at compile time via `ValidateScaleValues` mapped type + `Emitted` generic on ThemeBuilder. This preserves the mental model: refs point to variables.
- **Type checkpoint pattern:** Each `addScale` returns a new `ThemeBuilder` instance (via `#fork()`) with properly accumulated generics — same pattern as Animus component builder chain. `const` modifier on `Values` generic preserves string literals for template literal validation.
- **`Emitted` generic:** Second generic parameter on `ThemeBuilder<T, Emitted>` tracks emitted scale names through the chain. Colors always add `'colors'` to Emitted. `addScale({ emit: true })` adds the scale name.
