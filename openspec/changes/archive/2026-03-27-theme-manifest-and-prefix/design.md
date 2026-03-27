## Context

The ThemeBuilder (`createTheme().addScale().addColors().addColorModes().build()`) produces a theme object consumed in two ways: (1) TypeScript module augmentation for type-safe component props, and (2) Vite plugin evaluation for CSS extraction. Path (2) currently reconstructs token metadata by re-flattening the theme and pattern-matching `var(...)` strings in `theme-evaluator.ts`. The Rust crate receives three separate JSON string parameters (`scalesJson`, `variableMapJson`, `configJson`). Layer names are hardcoded in Rust. Class name prefixes are hardcoded to `animus-`. CSS variable names have no configurable prefix.

## Goals / Non-Goals

**Goals:**
- ThemeBuilder emits a structured manifest that flows to the plugin and Rust without reconstruction
- Configurable namespace prefix for CSS variables, class names, and layer names
- Consumer-controlled `@layer` declaration with enforced internal ordering
- Color value validation at build time with clear error messages
- Zero breaking changes to consumer-facing API (`createTheme`, module augmentation, `typeof tokens`)

**Non-Goals:**
- W3C Design Token Format (DTCG) alignment — future work, manifest can be retrofitted
- Token metadata beyond current scope ($description, $extensions)
- Responsive tokens (breakpoint-scoped values in manifest)
- General mode mechanism beyond colors (user considers this lower-level API design)
- Multi-variable rebinding / colorScheme primitive (separate change)
- Alias chain tracking (alias → alias → value resolution metadata)

## Decisions

### Decision 1: Manifest as property, not return shape change

**Choice:** `.build()` returns the same theme object as today. The manifest is exposed as a `.manifest` property on the returned theme.

**Why:** `typeof tokens` is the module augmentation anchor. Changing `.build()` to return `{ theme, manifest }` breaks every consumer's bootstrap file. A property preserves the existing pattern while making the manifest accessible.

**Alternatives considered:**
- `build({ manifest: true })` — opt-in flag, but complicates the type: return type becomes conditional
- Separate `.buildManifest()` method — requires calling build twice or splitting concerns unnaturally
- `build()` returns tuple `[theme, manifest]` — breaks destructuring patterns differently

**Implementation:** ThemeBuilder assembles `ThemeManifest` during `.build()`, attaches it via `Object.defineProperty(theme, 'manifest', { value: manifest, enumerable: false })`. Non-enumerable keeps it out of `JSON.stringify` and spread operations.

### Decision 2: Opaque ThemeManifest type

**Choice:** `ThemeManifest` is a plain interface with no generics:
```typescript
interface ThemeManifest {
  tokenMap: Record<string, string>;       // flat key → raw value
  variableMap: Record<string, string>;    // flat key → CSS variable name (no var() wrapper)
  modes: Record<string, Record<string, string>>; // mode name → key → resolved value
  variableCss: string;                    // pre-built :root + [data-color-mode] CSS
}
```

**Why:** The plugin reads manifest at build time as JS values, not TS types. Generic type parameters would add complexity with zero consumer benefit. Opaque is sufficient.

### Decision 3: Consolidated Rust FFI

**Choice:** Replace three JSON parameters (`scalesJson`, `variableMapJson`, `configJson`) with a single `manifestJson` parameter in `analyze_project()` and `transform_file()`. The manifest JSON includes token map, variable map, and extraction config. Prefix is included in the manifest.

**Why:** Cleaner FFI boundary. One deserialization pass in Rust via `serde_json`. Prefix travels alongside the data it modifies rather than as a separate parameter.

**Migration:** Both old and new function signatures exist briefly during implementation. Old signature removed once plugin is updated.

### Decision 4: Prefix applied at two Rust points

**Choice:** Prefix is applied in Rust at exactly two points:
1. **Variable map pre-processing:** Before the resolution loop, prefix all variable names in the map: `--color-primary` → `--{prefix}-color-primary`. One O(n) pass over the map. Token alias resolution then naturally emits prefixed var() references.
2. **Class name generation:** Prefix the component identifier before hashing: `{prefix}-Button` instead of `animus-Button`. Hash input changes, but the mechanism is the same.

**Why not in ThemeBuilder?** Prefix is an output concern. The theme's logical token names (`colors.primary`) are prefix-free. The builder shouldn't know about deployment namespacing.

### Decision 5: Layer configuration with enforced ordering

**Choice:** Plugin accepts an optional `layers` array — the complete `@layer` declaration. Plugin identifies which entries are Animus layers (by matching `{prefix}-global`, `{prefix}-base`, etc., or unprefixed names when no prefix). Validates that the 6 Animus layers appear in correct relative order: `global < base < variants < states < system < custom`. Consumer layers can appear before, after, or between any Animus layers.

**Validation:** At `configResolved`, the plugin extracts the Animus layer subsequence from the `layers` array and checks order. If violated, throws with message: `[animus] Invalid layer order: '{prefix}-custom' must come after '{prefix}-system'. Required order: global < base < variants < states < system < custom`.

**No `layers` config:** Current behavior — plugin emits `@layer global, base, variants, states, system, custom;` (or prefixed equivalents).

**Rust receives:** The ordered layer name array. Uses these names in `@layer` blocks instead of hardcoded strings.

### Decision 6: Color validation scope

**Choice:** `addColors()` validates values at runtime. Accepted: hex (`#fff`, `#ff2800`), rgb/rgba, hsl/hsla, oklch, oklab, lch, lab, named CSS colors (`red`, `blue`, etc.), `transparent`, `currentColor`. Rejected: gradients, `inherit`, `initial`, `unset`, objects, numbers (except as part of function syntax), arbitrary strings.

**Type level:** `addColors()` parameter type gains a template literal constraint with `(string & {})` escape hatch:
```typescript
type CSSColorValue =
  | `#${string}`
  | `rgb(${string})` | `rgba(${string})`
  | `hsl(${string})` | `hsla(${string})`
  | `oklch(${string})` | `oklab(${string})`
  | `lch(${string})` | `lab(${string})`
  | `color-mix(${string})`
  | 'transparent' | 'currentColor'
  | (string & {});
```

The `(string & {})` ensures future CSS color functions aren't blocked at the type level while still providing autocomplete for known patterns.

**Error messages** include the failing key: `addColors: 'linear-gradient(90deg, red, blue)' is not a valid CSS <color> value for key 'gradient'. Expected hex, rgb(), hsl(), oklch(), named color, transparent, or currentColor.`

**`addColorModes()` validation:** Each alias value must be a key in the current flattened color palette. If not, throws: `addColorModes: mode 'dark' references unknown color 'nonexistent' for alias 'primary'. Available colors: ember, scorch, coal, ...`

## Risks / Trade-offs

**[Risk] Non-enumerable `.manifest` property may surprise consumers who spread the theme** → Mitigation: Non-enumerable is the correct behavior — spreading a theme into component props shouldn't include a manifest object. Document that `.manifest` exists for plugin consumption.

**[Risk] Rust FFI signature change requires coordinated plugin + crate update** → Mitigation: Ship as a single version bump. The crate and plugin are always released together.

**[Risk] Color validation rejects values that consumers currently use** → Mitigation: `(string & {})` escape hatch at type level. Runtime validation logs warning instead of throwing for the first minor version, upgrades to throw in next major. Actually — since this is pre-RC, throw immediately. No existing consumers to break.

**[Risk] Layer validation may be overly strict** → Mitigation: Validation only checks relative order of Animus layers. Consumer layers are completely unconstrained. The validation error message explains the required order.

**[Trade-off] Manifest duplicates some data from the theme object** → Acceptable. The manifest is ~2-5KB of JSON for a typical theme. The alternative (not duplicating) requires the plugin to understand the theme object's internal structure, which is the fragile coupling we're eliminating.
