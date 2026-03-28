## Why

The current `addScale` API has two sources of friction:

1. **Callback wrapper is ceremony.** Every scale in the showcase is `() => ({...})` — a factory that ignores its parameter. The `(theme) => ...` form exists for derived scales, but the common case is a static value map wrapped in a pointless arrow function.

2. **`createScaleVariables()` is a separate step.** Colors emit CSS variables automatically via `.addColors()`. Scales don't — you must chain `.createScaleVariables('name')` separately. It's easy to forget, and there's no reason scales should behave differently from colors.

## What Changes

Simplify `addScale` to accept a flat keyed object (like variant configs) and automatically emit CSS variables for every scale.

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
    emit: true,
    values: { 0: '0', 4: '0.25rem', 8: '0.5rem', 16: '1rem' },
  })
  .addScale({
    name: 'sizes',
    emit: true,
    values: { navHeight: '48px', sidebarWidth: '200px' },
  })
  .addScale({
    name: 'borders',
    emit: false,
    values: { 1: '1px solid ', 2: '2px solid ' },
  })
  .build()
```

- Single config object: `{ name, emit, values }` — same shape as `.variant({ prop, variants, defaultVariant })`
- `emit: true` → generates CSS variables (`--space-0`, `--sizes-navHeight`)
- `emit: false` → scale values used for lookup only, no CSS variables
- Token ref syntax `{space.16}` and `{sizes.navHeight}` resolves to `var(--space-16)` / `var(--sizes-navHeight)` at extraction time
- Consistent API shape across the builder chain: variant configs, scale configs, compound configs all use the single-object pattern

## Impact

- **Theme API:** `addScale` signature changes from `(name, factory)` to `(name, values)`. Factory form removed or moved to a separate `addDerivedScale` if needed.
- **`createScaleVariables`:** Removed. All scales emit variables automatically.
- **Existing consumers:** Migration is mechanical — unwrap `() => (...)` to just `{...}`. Remove `createScaleVariables` calls.
- **Extraction pipeline:** Scale values already resolve through the variable map. The change is in the theme builder, not the Rust crate.
- **Type inference:** Flat object gives the same type inference as the factory return type. No loss.

## Open Questions

- Should scales that DON'T want CSS variables (e.g., `borders: { 1: '1px solid ' }`) have an opt-out? Or should every scale always emit variables?
- Does any existing scale use the `(theme) => ...` factory parameter? If not, the factory form can be removed entirely. If yes, keep it as an overload or move to `addDerivedScale`.
