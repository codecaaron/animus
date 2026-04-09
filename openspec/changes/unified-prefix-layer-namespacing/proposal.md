## Why

Bare `@layer` names like `base`, `variants`, `states` are generic enough to collide with other CSS on the page or other design systems. CSS variables and class names already support a `prefix` option, but layer names are hardcoded — meaning a consumer using `prefix: 'acme'` still emits unprotected `@layer base`. This gap makes the prefix feature incomplete: two of three emission surfaces are namespaced, one isn't.

## What Changes

- **Extend `prefix` to namespace `@layer` declarations** using native CSS dot-notation sublayers. `prefix: 'acme'` produces `@layer acme.base, acme.variants, ...` instead of `@layer base, variants, ...`. Browsers treat `acme.base` as a proper sublayer of `acme`, providing cascade containment.
- **Layer prefixing composes with custom `layers[]` ordering.** Only the 7 Animus layers get prefixed; consumer-interleaved layers pass through unchanged. `['reset', 'global', 'base', ...]` → `@layer reset, acme.global, acme.base, ...`.
- **Rust extractor accepts layer prefix parameter.** Hardcoded `@layer` string literals in `css_generator.rs` become parameterized, accepting an optional prefix from the NAPI boundary.
- **TS pipeline applies layer prefix at assembly time.** `assembleStylesheet()` and `applyPrefix()` gain layer-awareness alongside their existing var/class prefixing.

## Capabilities

### New Capabilities
- `layer-namespace-prefix`: CSS `@layer` dot-notation sublayer prefixing — transforms bare layer names to `{prefix}.{name}` at emission time, composes with custom layer ordering, applied in both Rust (per-component sheets) and TS (final assembly)

### Modified Capabilities
- `extraction-emitter-config`: The existing `prefix` option gains layer-prefixing behavior (currently only affects vars + classes)
- `theme-variable-emission`: Layer declaration line in variable CSS output must respect prefix

## Impact

- **Rust crate** (`extract/src/css_generator.rs`): `generate_css()`, `generate_sheets_from_slice()`, `generate_utility_css_impl()` — thread `layer_prefix` param through all `@layer` emission points
- **TS pipeline** (`extract/pipeline/`): `assemble-stylesheet.ts` declaration builder, `prefix.ts` regex transforms
- **Vite plugin** (`vite-plugin/src/index.ts`): Propagate prefix to layer generation calls
- **NAPI boundary** (`extract/src/lib.rs`): Pass prefix to Rust CSS generation functions
- **No breaking changes**: Default behavior (no prefix) is unchanged. This is purely additive.
