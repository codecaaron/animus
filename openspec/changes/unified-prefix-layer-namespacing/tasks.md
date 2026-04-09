## 1. TS Pipeline — Layer Prefix Helper

- [ ] 1.1 Add `prefixLayerName(name: string, prefix?: string)` helper to `extract/pipeline/assemble-stylesheet.ts` — returns `{prefix}.{name}` when prefix is set, bare `{name}` otherwise
- [ ] 1.2 Update `assembleStylesheet()` to accept optional `prefix` param and use `prefixLayerName` when building the `@layer` declaration line and wrapping per-layer CSS blocks
- [ ] 1.3 Update `DEFAULT_LAYER_DECLARATION` generation to be a function that accepts optional prefix

## 2. TS Pipeline — applyPrefix Layer Awareness

- [ ] 2.1 Extend `applyPrefix()` in `extract/pipeline/prefix.ts` to transform `@layer` declaration lines — prefix only known `ANIMUS_LAYERS` names, leave consumer layer names untouched
- [ ] 2.2 Extend `applyPrefix()` to transform `@layer X {` block wrappers — match known Animus layer names and apply dot-notation prefix
- [ ] 2.3 Import `ANIMUS_LAYERS` into `prefix.ts` for the known-name set used in layer matching

## 3. Rust Extractor — Parameterize Layer Names

- [ ] 3.1 Add `layer_prefix: Option<String>` field to the config struct or function parameters in `css_generator.rs`
- [ ] 3.2 Update `generate_css()` to use prefixed layer names in the declaration line and all `@layer X {` wrappers when `layer_prefix` is `Some`
- [ ] 3.3 Update `generate_sheets_from_slice()` to use prefixed layer names in the `declaration` field and per-layer CSS strings
- [ ] 3.4 Update `generate_utility_css_impl()` to accept and apply `layer_prefix` to `@layer system {` and `@layer custom {` wrappers
- [ ] 3.5 Thread `layer_prefix` from NAPI boundary (`lib.rs` `analyze_project`) through to all CSS generation call sites

## 4. Vite Plugin — Propagate Prefix to Layer Generation

- [ ] 4.1 Pass `prefix` option to `assembleStylesheet()` calls in `vite-plugin/src/index.ts`
- [ ] 4.2 Pass `prefix` to Rust NAPI `analyze_project()` call for layer prefix threading
- [ ] 4.3 Ensure `storedSheets` (dev mode per-layer CSS) uses prefixed layer names when prefix is set

## 5. Custom Layer Ordering Composition

- [ ] 5.1 Verify `validateLayerOrder()` continues to work with bare names (no changes expected — prefix applied after validation)
- [ ] 5.2 Update the layer declaration builder to apply prefix only to Animus layer names in a mixed `layers[]` array, passing consumer layer names through unprefixed

## 6. Canary Test

- [ ] 6.1 Add one canary test: `prefix: 'acme'` produces `@layer acme.base {` in output CSS, `--acme-color-*` in variable CSS, and `acme-*` class names
- [ ] 6.2 Add one canary test: `prefix: 'acme'` + `layers: ['reset', ...animus..., 'overrides']` produces correct interleaved prefixed declaration
