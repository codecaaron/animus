## Context

Every theme dimension except breakpoints expands and contracts to match the consumer's configuration. Define 3 color scales → types show 3. Define 10 → types show 10. Breakpoints are the exception: the `Breakpoints<T>` interface mandates exactly 5 keys (`xs, sm, md, lg, xl`) regardless of what the consumer actually needs. This creates two problems:

1. **Can't contract**: A project using only `{ sm, lg }` still sees 5 breakpoint keys in autocomplete. Using a phantom key like `md` silently produces nothing — no type error, no build warning.
2. **Can't expand**: A project needing `2xl` or `3xl` has no way to add them. The hardcoded interface is a ceiling.

The responsive array syntax (`[default, xs, sm, md, lg, xl]`) compounds this — it's positional and can't adapt to fewer or more breakpoints.

The augmented `Theme` interface pattern (module augmentation → type-safe scale lookups) already proves this expand/contract architecture works for every other dimension. Breakpoints should follow the same path: define your keys, the types contract to match.

### Current State

| Layer | Hardcoded Location | What |
|-------|-------------------|------|
| Types (system) | `Breakpoints<T>` interface | Fixed `{ xs, sm, md, lg, xl }` |
| Types (system) | `MediaQueryMap<T>`, `MediaQueryByKey<T>`, `MediaQueryArray<T>` | Fixed responsive shapes |
| Types (core) | Duplicate `Breakpoints<T>` interface | Same |
| Runtime (core) | `BREAKPOINT_KEYS` constant | `['_', 'xs', 'sm', 'md', 'lg', 'xl']` |
| Runtime (core) | `createMediaQueries()` | Destructures `{ xs, sm, md, lg, xl }` |
| Runtime (core) | `createStylist` line 169 | `['xs', 'sm', 'md', 'lg', 'xl'].map()` |
| Rust | `BREAKPOINT_KEYS` constant | `["_", "xs", "sm", "md", "lg", "xl"]` |
| Rust | `is_responsive_value()` | Uses hardcoded constant |
| Theming | `ThemeWithBreakpoints<Bps extends Breakpoints>` | Constrained to fixed interface |

**Already dynamic** (no changes needed):
- `extract_breakpoints()` in Rust — reads from flattened theme HashMap, key-agnostic
- `BreakpointMap` in css_generator.rs — `HashMap<String, u32>`, generates media queries from any keys
- `resolve_responsive_prop()` in Rust — iterates object keys, not hardcoded
- `objectParser()` in core — uses `Object.keys(breakpoints)`, mostly dynamic
- Vite plugin — passes theme as JSON, no breakpoint assumptions
- `ThemeBuilder.build()` in system — serializes `breakpoints` via `serializeTokens()`, key-agnostic

## Goals / Non-Goals

**Goals:**
- Types expand and contract to match configuration: `{ sm: 640, lg: 1024 }` → responsive props accept exactly `_`, `sm`, `lg`. `{ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440, '2xl': 1920 }` → all six plus `_`.
- Only object syntax for responsive props (`{ _: val, md: val }`)
- Runtime and Rust derive breakpoint keys from theme, zero hardcoded constants
- Existing `{ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 }` continues to work identically (non-breaking for current consumers who keep the same keys)

**Non-Goals:**
- Container queries or other responsive mechanisms (future)
- Non-pixel breakpoint units (em, rem) — may revisit later
- Responsive array syntax preservation — explicitly removing
- Breakpoint-less themes (breakpoints are still required in createTheme)

## Decisions

### Decision 1: Replace `Breakpoints<T>` with unconstrained Record

**Choice:** `BaseTheme.breakpoints` becomes `Record<string, number>`. No fixed interface.

**Alternative considered:** Making `Breakpoints<T>` generic over keys (`Breakpoints<Keys extends string, T = number> = Record<Keys, T>`). Rejected because this adds a generic parameter that propagates through `BaseTheme`, `AbstractTheme`, and every function signature that touches themes. The augmented `Theme` interface already carries the concrete key set — a generic is redundant.

**How it works:** The augmented `Theme` interface (via `declare module '@animus-ui/system'`) carries the concrete breakpoint type. `MediaQueryMap<T>` reads `Theme['breakpoints']` at the type level. When not augmented, `BaseTheme.breakpoints = Record<string, number>` means any string key is valid (open, not restrictive).

### Decision 2: `MediaQueryMap<T>` as a conditional mapped type

```ts
type BreakpointKeys = keyof Theme['breakpoints'];

type MediaQueryMap<T> = { _?: T } & (
  string extends BreakpointKeys
    ? { [key: string]: T | undefined }  // unaugmented: open
    : { [K in BreakpointKeys]?: T }     // augmented: exact keys
);
```

**Rationale:** When `Theme` is augmented, `BreakpointKeys` resolves to a finite union (`'xs' | 'sm' | 'md' | 'lg' | 'xl'`) and the mapped type produces exact optional properties. When NOT augmented, `BreakpointKeys` is `string` (from `Record<string, number>`), and the conditional falls to the open arm — any key accepted.

**Risk:** TSC mapped types over `keyof` can be expensive. Mitigation: `Theme['breakpoints']` is a flat record (no nesting), so the mapped type is shallow.

### Decision 3: Remove array syntax entirely

**Choice:** Delete `MediaQueryArray<T>`, `arrayParser()`, `isMediaArray()`, and all array-related responsive code.

**Alternative considered:** Keep array syntax but make it index-based on theme key order. Rejected because: (a) positional semantics are fragile — reordering breakpoints changes the meaning of every array, (b) it's a second syntax for the same thing with strictly worse DX, (c) it adds complexity to the type system (tuple type from breakpoint count).

### Decision 4: Pass breakpoint key set to Rust via existing theme serialization

**Choice:** `is_responsive_value()` receives `&HashSet<String>` of valid breakpoint keys, extracted from the same `extract_breakpoints()` that already parses the theme. The `BREAKPOINT_KEYS` constant is deleted.

**Alternative considered:** A separate `breakpoint_keys` parameter to NAPI functions. Rejected because the keys are already in the flattened theme as `breakpoints.*` entries — no new parameter needed.

**Signature change:**
```rust
fn is_responsive_value(value: &Value, breakpoint_keys: &HashSet<String>) -> bool
```

This parameter threads from `extract_breakpoints()` → `resolve_styles()` → `is_responsive_value()`.

### Decision 5: Runtime breakpoint resolution from theme object

**Choice:** `createMediaQueries()` iterates `Object.keys(breakpoints)` in insertion order. `createStylist`'s `getMediaSelectors` does the same. No destructuring, no hardcoded array.

```ts
export const createMediaQueries = (breakpoints?: Record<string, number>): MediaQueryCache | null => {
  if (!breakpoints) return null;
  const keys = Object.keys(breakpoints);
  return {
    map: Object.fromEntries(keys.map(k => [k, templateMediaQuery(breakpoints[k])])),
    array: keys.map(k => templateMediaQuery(breakpoints[k])),
  };
};
```

### Decision 6: `compatTheme` retains default breakpoints

**Choice:** `compatTheme.breakpoints` keeps `{ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 }` as the runtime fallback for components that don't have a theme. This is backward-compatible.

**Rationale:** The runtime still needs a fallback when `props.theme` is undefined (e.g., unit tests, Storybook). The default set doesn't constrain the TYPE system — it's just the runtime default.

## Risks / Trade-offs

### [Risk] Type inference performance
Mapped types over `keyof Theme['breakpoints']` could slow TSC on large codebases.
→ **Mitigation:** The mapped type is shallow (one level, 3-6 keys typically). Benchmark TSC on the showcase after implementation. If slow, consider caching the type via a type alias in the augmentation.

### [Risk] Responsive detection false positives in Rust
With custom breakpoint keys like `color` or `size`, an object `{ color: 'red', size: '16px' }` could be misdetected as responsive if both happen to be breakpoint key names.
→ **Mitigation:** This risk already exists with the current system (a style prop whose keys are all breakpoint names). In practice, breakpoint keys are conventionally abbreviations (`sm`, `md`, `lg`) that don't collide with CSS property names. Document that breakpoint keys should not overlap with CSS property names or scale keys.

### [Risk] Core package backward compatibility
The `core` package's `Breakpoints` interface and responsive types are used by the legacy theming package.
→ **Mitigation:** Update both `core` and `system` in lockstep. The theming package's `ThemeWithBreakpoints<Bps extends Breakpoints>` becomes `ThemeWithBreakpoints<Bps extends Record<string, number>>`. Since `{ xs: 480, sm: 768, ... }` satisfies `Record<string, number>`, existing code compiles.

### [Risk] `MediaQueryCache` type changes
`MediaQueryByKey<T>` (used in `MediaQueryCache.map`) is currently a fixed interface. Changing to dynamic keys means `MediaQueryCache.map` becomes `Record<string, string>`.
→ **Mitigation:** `MediaQueryCache` is internal to `core/styles/`. No public API surface exposed. The change is mechanical.

### [Trade-off] Array syntax removal
Some existing codebases may use array syntax. This is a breaking change.
→ **Mitigation:** Array syntax is a niche feature primarily used in docs examples. Migration is mechanical (array → named object). A codemod could automate it, but the showcase has minimal array usage.
