## 1. TS Pipeline — Layer Prefix Helper

- [x] 1.1 Add `prefixLayerName(name: string, prefix?: string)` helper to `extract/pipeline/assemble-stylesheet.ts` — returns `{prefix}-{name}` when prefix is set and name is in ANIMUS_LAYER_SET, bare `{name}` otherwise
- [x] 1.2 Add `ANIMUS_LAYER_SET` as `ReadonlySet<string>` for O(1) membership checks
- [x] 1.3 Update `buildLayerDeclaration()` to accept `isCustom` flag — when custom, pass names through as-is (consumer already wrote final names); when default, apply `prefixLayerName`
- [x] 1.4 Update `assembleStylesheet()` to accept optional `prefix` param and pass to validation + declaration builder
- [x] 1.5 Export `prefixLayerName` from pipeline barrel (`extract/pipeline/index.ts`)

## 2. TS Pipeline — validateLayerOrder Prefix Awareness

- [x] 2.1 Update `validateLayerOrder(layers, prefix?)` to build expected names as `{prefix}-{name}` when prefix is set
- [x] 2.2 Validation checks prefixed Animus names as required subsequence — consumer writes actual CSS names in config

## ~~3. TS Pipeline — applyPrefix Layer Awareness~~ (SKIPPED)

~~Tasks 3.1-3.3 skipped — architecturally unnecessary. `applyPrefix()` only receives variable JSON/CSS, never `componentCss` or `globalCss`. All `@layer` emissions pass through controlled paths with direct prefix awareness.~~

## 4. Rust Extractor — Parameterize Layer Names

- [x] 4.1 Add `pub prefix_layer(name, prefix: Option<&str>)` helper to `css_generator.rs` — returns `{prefix}-{name}` for Some, bare name for None
- [x] 4.2 Add `layer_prefix: Option<&str>` param to `generate_css()` — use helper for declaration line and all 4 `@layer X {` block wrappers
- [x] 4.3 Add `layer_prefix: Option<&str>` param to `generate_sheets_from_slice()` — use helper for declaration and all 4 `@layer X {` format strings
- [x] 4.4 Add `layer_prefix: Option<&str>` param to `generate_css_sheets_ordered()` — pass through to `generate_sheets_from_slice()`
- [x] 4.5 Add `layer_prefix: Option<&str>` param to `generate_utility_css()` — build prefixed layer name, pass to `generate_utility_css_impl()`
- [x] 4.6 Add `layer_prefix: Option<&str>` param to `generate_custom_prop_css()` — build prefixed layer name, pass to `generate_utility_css_impl()`
- [x] 4.7 Update `project_analyzer.rs`: add `layer_prefix: Option<&str>` to `analyze()`, thread to all CSS generation call sites
- [x] 4.8 Update `project_analyzer.rs`: variants sublayer wrapper uses `prefix_layer("variants", layer_prefix)` for outer `@layer variants {`
- [x] 4.9 Update `lib.rs`: derive `layer_prefix` from `prefix` param (`prefix.as_deref()`), pass to `analyze()`
- [x] 4.10 Update all Rust test call sites to pass `None` for `layer_prefix` (backward compat)

## 5. Vite Plugin — Propagate Prefix to Layer Generation

- [x] 5.1 Import `prefixLayerName` from `@animus-ui/extract/pipeline`
- [x] 5.2 Prefix `@layer global {` wrapper using `prefixLayerName('global', options.prefix)`
- [x] 5.3 Pass `prefix: options.prefix` to all 3 `assembleStylesheet()` call sites (diagnostics, dev, prod)
- [x] 5.4 Pass `options.prefix` to `validateLayerOrder()` call

## 6. Canary Tests

- [x] 6.1 TS assembly: prefix produces dash-prefixed namespaced layer declaration
- [x] 6.2 TS assembly: prefix + custom layers — consumer writes actual CSS names, passed through as-is
- [x] 6.3 TS assembly: TW interleaving — bare `base` (TW) + `acme-base` (Animus) coexist
- [x] 6.4 TS assembly: no prefix produces bare layer names
- [x] 6.5 Rust: layer declaration uses dash-prefixed namespaced names
- [x] 6.6 Rust: base layer block uses prefixed name
- [x] 6.7 Rust: variants namespaced layer uses prefixed name
- [x] 6.8 Rust: class names use the prefix
- [x] 6.9 Rust: sheets.declaration uses prefixed names
