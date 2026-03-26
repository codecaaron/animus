## Why

The extraction pipeline currently handles one case: statically resolvable prop values found by the JSX scanner. When a system or custom prop receives a dynamic value (variable reference, ternary, function call), the value silently disappears — no utility class exists, no fallback fires, the CSS property is never set. This is the single largest gap in the compiler.

Additionally, custom props (`.props()`) have inline scale support in the type system (`scale: { xs: '10rem', sm: '15rem' }` and `createScale<'sm' | 'md'>()`) that the Rust pipeline doesn't fully handle — `PropConfig.scale` only accepts string theme-scale references, silently dropping inline scale objects via `#[serde(default)]`.

Closing this gap is the path to compiler completion. After this, the extraction pipeline handles every value a user can legally write — static values get zero-recalc utility classes, dynamic values get CSS-variable-backed fallback classes with one style recalc.

## What Changes

### 1. Inline scale support in Rust PropConfig

- **Fix `PropConfig.scale`** to accept `serde_json::Value` instead of `Option<String>` — handles string theme references, inline map scales, inline array scales, and empty `createScale` arrays
- **Empty scale passthrough** — when scale is an empty array (from `createScale` phantom types), the value passes through raw. It already type-checked in TS. Apply any configured transform, emit as-is.
- **Inline map/array scale resolution** — when scale is an object or non-empty array, resolve the value against it directly (no theme lookup)

### 2. Dynamic value detection in JSX scanner

- **Identify dynamic prop values** — when the JSX scanner encounters a prop value that is an identifier, call expression, conditional expression, or any non-literal AST node, mark it as dynamic
- **Emit dynamic prop metadata** — for each dynamic prop usage, record `(prop_name, component_binding)` alongside static usages. This triggers CSS variable slot generation.
- **Spreads remain ignored** — `{...props}` is not scanned. Future: optional utility for targeting spreads.

### 3. CSS variable slot class generation

- **Per-prop variable slot class** — for each prop that has at least one dynamic usage, generate a CSS class that reads from CSS custom properties instead of hardcoded values
- **Breakpoint fallback chains** — each breakpoint variable falls back to the base variable via `var(--name-bp, var(--name))`. One class handles both primitive and responsive dynamic values without build-time type inference.
- **Lazy generation** — only props with detected dynamic usage get variable slot classes. Props with only static values get zero dynamic overhead.
- **Layer placement** — variable slot classes go in `@layer system` (for group props) or `@layer custom` (for custom props), same as their static counterparts

Example output for a dynamic `size` prop with 3 breakpoints:
```css
@layer custom {
  .animus-Box--size-var {
    flex-basis: var(--animus-size);
  }
  @media (min-width: 768px) {
    .animus-Box--size-var {
      flex-basis: var(--animus-size-sm, var(--animus-size));
    }
  }
  @media (min-width: 1024px) {
    .animus-Box--size-var {
      flex-basis: var(--animus-size-md, var(--animus-size));
    }
  }
}
```

### 4. Runtime dynamic prop resolution

- **Fallback path in createComponent** — when a prop value has no class match in the shared map (system props) or per-component map (custom props), fall back to CSS variable assignment via inline style
- **Transform application** — if the prop has a transform, apply it to the dynamic value before setting the CSS variable. Transform functions ship in the virtual module, keyed by name.
- **Responsive object handling** — for responsive values `{ _: x, sm: y }`, set per-breakpoint CSS variables (`--animus-size`, `--animus-size-sm`). CSS fallback chains handle missing breakpoints.
- **CSS property mapping** — the runtime needs to know which CSS variable name to set for each prop. This mapping is derived from the PropConfig at build time.

### 5. Transform registry shipping

- **Lazy inclusion** — only transform functions actually used by dynamic props ship to the runtime via the virtual module
- **Transform functions are value→CSS pure functions** — they don't need to know about static vs. dynamic context, properties, or breakpoints. Same function at build time and runtime.
- **Ship as named exports** — `virtual:animus/system-props` gains a `transforms` export alongside `systemPropMap` and `systemPropGroups`

## Capabilities

### New Capabilities
- `dynamic-prop-fallback`: CSS variable slot class generation, runtime dynamic resolution, and transform shipping for props that receive non-static values

### Modified Capabilities
- `extraction-runtime-shim`: `createComponent` gains dynamic prop fallback logic — CSS variable assignment via inline style when no class match found
- `rust-extraction-pipeline`: JSX scanner gains dynamic value detection. PropConfig.scale accepts inline scales. CSS generator produces variable slot classes.
- `vite-extraction-plugin`: Virtual module gains `transforms` export for runtime transform application
- `jsx-system-prop-scanner`: Scanner distinguishes static (literal) from dynamic (identifier/expression) prop values
- `prop-system`: PropConfig.scale handles all three forms (string reference, inline map/array, empty createScale phantom)

## Impact

- **packages/extract** (Rust): PropConfig.scale type change, JSX scanner dynamic detection, CSS generator variable slot class emission, manifest gains dynamic prop metadata
- **packages/system** (TS): `createComponent` gains fallback logic with CSS variable assignment and transform application
- **packages/vite-plugin** (TS): Virtual module serves transform functions, variable slot metadata
- **CSS output**: New variable-backed utility classes for dynamic props (per-breakpoint with fallback chains)
- **Bundle size**: Transform registry adds bytes only for transforms used by dynamic props. Variable slot classes add ~4 CSS rules per dynamic prop per breakpoint count.
- **Performance**: Zero style recalc for static values (unchanged). One style recalc per dynamic prop change (CSS variable update). User pays only for dynamism.
- **Type system**: No changes — `createScale` phantom types, inline scales, and responsive objects already type-check correctly. This change makes the compiler honor what the types allow.

## Design Principles

1. **Static is the fast path** — extracted utility classes, zero recalc, zero runtime. This is unchanged and remains the default.
2. **Dynamic is the fallback** — CSS variable slots, one recalc, minimal runtime. Triggered ONLY by values the scanner can't resolve statically. The user forced it.
3. **Transforms are context-free** — same function works at build time and runtime. No special dynamic-aware transform API needed.
4. **Lazy everything** — variable slot classes, transform shipping, and dynamic prop config are only generated/shipped for props that actually receive dynamic values. Zero cost if unused.
5. **CSS variable fallback chains** — one class handles both primitive and responsive dynamic values. No build-time type inference required for breakpoint slot generation.
