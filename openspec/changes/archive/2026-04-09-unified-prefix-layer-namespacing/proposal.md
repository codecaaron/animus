## Why

Bare `@layer` names like `base`, `variants`, `states` are generic enough to collide with other CSS on the page or other design systems. CSS variables and class names already support a `prefix` option, but layer names are hardcoded — meaning a consumer using `prefix: 'acme'` still emits unprotected `@layer base`. This gap makes the prefix feature incomplete: two of three emission surfaces are namespaced, one isn't.

## What Changes

- **Extend `prefix` to namespace `@layer` declarations** using dash-prefixed flat layers. `prefix: 'acme'` produces `@layer acme-base, acme-variants, ...` instead of `@layer base, variants, ...`. Flat dash-prefixed names allow interleaving with other frameworks' layers without sublayer containment constraints.
- **Layer prefixing composes with custom `layers[]` ordering.** When `prefix` is set, consumers write actual CSS names in their config: `['base', 'acme-global', 'acme-base', ...]`. This enables coexistence with frameworks like Tailwind that also emit `@layer base`. Validation checks for prefixed Animus names as the required subsequence.
- **Rust extractor accepts layer prefix parameter.** Hardcoded `@layer` string literals in `css_generator.rs` become parameterized, accepting an optional prefix from the NAPI boundary.
- **TS pipeline applies layer prefix at assembly time.** `assembleStylesheet()` gains layer-awareness. `applyPrefix()` unchanged — layer prefixing is handled at emission points, not via post-process regex.

## Capabilities

### New Capabilities
- `layer-namespace-prefix`: CSS `@layer` dash-prefix namespaced layer naming — transforms bare layer names to `{prefix}-{name}` at emission time, composes with custom layer ordering, applied in both Rust (per-component sheets) and TS (final assembly)

### Modified Capabilities
- `extraction-emitter-config`: The existing `prefix` option gains layer-prefixing behavior (currently only affects vars + classes)
- `theme-variable-emission`: Layer declaration line in variable CSS output must respect prefix

## Impact

- **Rust crate** (`extract/src/css_generator.rs`): `generate_css()`, `generate_sheets_from_slice()`, `generate_utility_css()`, `generate_custom_prop_css()` — thread `layer_prefix` param through all `@layer` emission points via `prefix_layer()` helper
- **Rust crate** (`extract/src/project_analyzer.rs`): `analyze()` threads `layer_prefix` to all CSS generation call sites including variants sublayer wrapper
- **TS pipeline** (`extract/pipeline/assemble-stylesheet.ts`): `prefixLayerName()` helper, `buildLayerDeclaration()`, `validateLayerOrder(layers, prefix?)` prefix-aware validation
- **Vite plugin** (`vite-plugin/src/index.ts`): Prefix `@layer global {` wrapper, pass prefix to `assembleStylesheet()` and `validateLayerOrder()`
- **NAPI boundary** (`extract/src/lib.rs`): Derive `layer_prefix` from prefix param, pass to `analyze()`
- **No breaking changes**: Default behavior (no prefix) is unchanged. This is purely additive.
