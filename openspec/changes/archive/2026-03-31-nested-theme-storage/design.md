## Context

The `ThemeBuilder` chain (`createTheme.ts`) processes raw inputs through a destructive pipeline:

1. `addColors(colors)` → `flattenScale(colors)` → `serializeTokens(flat)` → merge flat + var() refs into `#theme`
2. `addScale({ name, values })` → `flattenScale(values)` → optional `serializeTokens` → merge flat into `#theme`
3. `addColorModes(initialMode, config)` → `mapValues(config, flattenScale)` → merge flat aliases into `#theme`
4. `build()` → `resolveThemeTokenRefs` mutates `_tokens` in-place → assemble manifest → attach serialize()

After this pipeline, the original nested inputs are gone. The flat dash-joined key format (`gray-50`) leaks from CSS custom property naming into the internal storage, user-facing mode alias syntax, and token ref syntax. With nested storage, the internal path separator becomes `.` (dot-path), and the dash-join becomes purely a CSS serialization concern.

The `SystemBuilder` follows a clean pattern: `createSystem()` takes no args, methods enforce no ordering, `.includes()` exists for composition. The component builder (`ds.styles()` → `.variant()` → `.compound()` → etc.) enforces cascade ordering via type-state narrowing. ThemeBuilder v3 adopts the type-state approach for its dependency chain.

## Goals / Non-Goals

**Goals:**
- Store raw nested inputs as the internal representation in ThemeBuilder
- Use dot-path (`.`) as the internal/user-facing path separator; dash-join (`-`) only at CSS serialization boundary
- Enforce builder chain ordering via type-state narrowing (breakpoints → colors → modes → scales → contextualVars)
- Provide `.from(libTokens)` composition entry point with deep merge semantics
- Make `createTheme()` fully additive (no constructor args)
- Flatten only at build-time boundaries (serialize, manifest) — no mid-chain flatten needed
- Maintain identical CSS output (same variable names, same manifest format)
- Align terminology across both builders

**Non-Goals:**
- Changing the extraction pipeline, vite-plugin, next-plugin, or Rust crate
- Changing the SystemBuilder API
- Type-state enforcement on SystemBuilder (it doesn't have ordering dependencies)
- Modifying the `Theme` module augmentation pattern

## Decisions

### 1. `createTheme()` takes no arguments; breakpoints become `.addBreakpoints()`

**Decision:** `createTheme()` returns an empty `ThemeBuilder`. Breakpoints are added via `.addBreakpoints({ sm: 768, lg: 1200 })`.

**Why:** Aligns with SystemBuilder's `createSystem()` pattern. Makes composition uniform — every piece of theme config enters through a method call. Breakpoints are recommended first in the chain because downstream scales may reference them, but `.from()` relaxes this for extension chains.

### 2. Dot-path as the internal path separator

**Decision:** All user-facing references to nested token keys use dot-path notation. The dash-join format exists only at the CSS serialization boundary.

- Mode aliases: `{ dark: { muted: 'gray.50' } }` (was `'gray-50'`)
- Token refs: `{colors.gray.50}` (was `{colors.gray-50}`)
- manifest.tokenMap keys: `'colors.gray.50'` (was `'colors.gray-50'`)
- CSS variable output: `--color-gray-50` (unchanged — dash is the CSS convention)
- `LiteralPaths<T, '.'>` computes dot-path keys from nested structure

**Why:** With nested storage, the natural path separator is `.` — it matches JS object access (`theme.colors.gray['50']`). The dash-join was CSS leaking into the API. Separating them eliminates the mid-chain flat-key lookup problem: `addColorModes` validates by walking the nested structure using dot-path traversal, not flat key lookup. Token refs resolve by nested path traversal. `flattenScale` is ONLY called at the serialization boundary.

**Impact on CSS output:** Unchanged. `--color-gray-50` is still the emitted variable name. The dot→dash conversion happens in `flattenTheme()` at build time.

### 3. Store nested inputs directly on `#theme` — no separate accumulator

**Decision:** Raw nested inputs are the theme's state. `#theme.colors` holds `{ gray: { 50: '#fafafa' } }`. No `_tokens`, no `_variables`, no `#rawConfig`.

**Why:** If the internal representation IS nested, there's nothing to "unpack" or accumulate separately. The theme IS the raw form.

### 4. Type-state chain ordering

**Decision:** The builder enforces ordering via type narrowing, matching the component builder pattern:

```
ThemeEmpty                    ← createTheme()
  → ThemeWithBreakpoints      ← .addBreakpoints()
    → ThemeWithColors         ← .addColors()
      → ThemeWithModes        ← .addColorModes() (only after colors)
        → ThemeWithScales     ← .addScale() (can ref emitted colors)
          → ThemeComplete     ← .declareContextualVars() / .build()
```

Each method returns a narrower type. Methods from earlier phases are still available (you can call `addColors` after `addScale` — it augments). But `addColorModes` requires colors to exist (type-level enforcement).

**Why:** Matches the component builder's cascade ordering philosophy. Prevents runtime errors from ordering violations (calling `addColorModes` before `addColors` currently throws at runtime — now it's a compile error).

**Extension chains:** `.from(libTokens)` loads a built theme's config and advances to a state where all methods are available for augmentation.

### 5. `.from(libTokens)` composition entry point

**Decision:** Add a `.from()` method on ThemeBuilder that accepts a built theme and seeds the builder with its raw config. Returns a builder in "extension" state where all `add*` methods augment via deep merge.

```ts
createTheme()
  .from(libTokens)
  .addColors({ brand: { 500: '#custom' } })  // deep merges on top
  .addScale({ name: 'custom', values: {...} })
  .build()
```

**Why:** Solves the "take everything" composition problem. Spreading 8 properties into 8 method calls is verbose and fragile (library adds a 9th scale, consumer misses it). `.from()` takes everything, consumer augments selectively. Deep merge semantics match SystemBuilder's overlap tolerance on `addGroup`.

**Alternative considered:** Property spreading only. Rejected after agnostic review flagged the "8 scales = 8 spread calls" ergonomic cost and the "new scale from library upgrade" fragility.

### 6. Flatten at `build()` time via `flattenTheme()` internal pass

**Decision:** At `build()`, a single `flattenTheme(theme, emittedScales)` pass produces all flat structures. No mid-chain flattening needed because dot-path traversal replaces flat-key lookup.

**The flatten pass:**
- Walk nested colors → produce flat tokens (dot→dash for CSS var names) + CSS variable declarations
- Walk nested scales → produce flat scale tokens + optional CSS var declarations
- Walk nested mode aliases → resolve dot-path aliases against nested colors → produce flat mode maps
- Resolve token refs (`{scale.path}`) by nested traversal → substitute resolved values
- Assemble manifest from flattened output

**Why:** Dot-path eliminates the mid-chain flat-key dependency that the red team found (R1-R3). `addColorModes` no longer needs `this.#theme.colors['gray-50']` — it walks `this.#theme.colors.gray['50']` via dot-path traversal. Token ref resolution walks nested structure instead of flat lookup.

### 7. Built theme shape

**Decision:** The built theme exposes:
- Enumerable: `breakpoints`, `colors`, `space`, `fontSizes`, etc. — all in original nested form
- Enumerable: `modes`, `mode` — color mode config and initial mode key
- Non-enumerable: `manifest`, `serialize()`, `varRef()` — boundary accessors

**Why:** The enumerable surface IS the raw config. Consumers can spread it or pass it to `.from()`. Non-enumerable boundary methods handle serialization and the rare runtime var() lookup.

### 8. `varRef(tokenPath)` replaces `resolve()`

**Decision:** Non-enumerable `varRef(path: string): string` on the built theme. Takes a dot-path like `'colors.gray.50'` and returns `'var(--color-gray-50)'`. Returns the raw value for non-emitted scales.

**Why:** Name communicates what it returns (a `var()` reference). Single-arg dot-path is consistent with manifest token path format and the dot-path-everywhere decision. Escape hatch only — no known caller in the extraction world.

### 9. Terminology alignment

**Decision:** Rename across both builders for consistency:

| Current | New | Why |
|---------|-----|-----|
| `addContextualVars` | `declareContextualVars` | Phantom type annotations, not token data — `declare` captures this |
| `updateScale` | `extendScale` | Breaks the `add*` story; "extend" matches the merge semantics |
| `tokens.serialize()` | `tokens.serialize()` (keep) | It produces JSON strings — it IS serialization |
| `ds.serialize()` | `ds.toConfig()` | Produces config objects, not JSON strings. Disambiguates from theme serialize |
| `flattenScale` | Internal only | Serialization utility, not consumer API |
| `serializeTokens` | Internal only | Serialization utility, not consumer API |

### 10. Private theme fields removed

**Decision:** `_variables`, `_tokens`, `_getColorValue` do not exist on the built theme. They exist only as locals within `build()`.

**Why:** Implementation details that leaked onto the public shape. The pipeline accesses flat data through `manifest` and `serialize()`.

## Risks / Trade-offs

- **Pre-release** — No external contract obligations. All changes are internal to the monorepo. Migration is find-and-replace across 3-4 call sites.

- **Type-state adds builder complexity** — Multiple class types instead of one. But this mirrors the proven component builder pattern and prevents runtime ordering errors.

- **Dot-path token ref syntax change** — `{colors.gray-50}` → `{colors.gray.50}`. The Rust crate's token ref parser needs updating to split on dot-path. This is a downstream cleanup task.

- **`extendScale` callback receives nested form** — Consumer callbacks that expected flat keys need updating. Since this is pre-release, just update the call sites.

- **`.from()` deep merge semantics** — Multiple `addColors` calls deep-merge. If consumer and library have the same nested key, consumer wins. This is correct (consumer intent overrides library default) but worth documenting.

## Open Questions

None — all resolved by the review process.
