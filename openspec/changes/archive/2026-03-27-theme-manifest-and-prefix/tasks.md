## 1. ThemeManifest Type & Assembly

- [x] 1.1 Add `ThemeManifest` interface to `packages/system/src/types/theme.ts` — opaque type with `tokenMap`, `variableMap`, `modes`, `variableCss` fields
- [x] 1.2 Add `CSSColorValue` type to `packages/system/src/types/theme.ts` — template literal union with `(string & {})` escape hatch
- [x] 1.3 Implement manifest assembly in ThemeBuilder `.build()` — collect tokenMap from flattened scales, variableMap from serialized token mappings, modes from resolved mode values, variableCss from existing variable CSS generation
- [x] 1.4 Attach manifest to built theme via `Object.defineProperty` (non-enumerable) — verify `typeof tokens` is unchanged and spread excludes manifest
- [x] 1.5 Export `ThemeManifest` from `packages/system/src/index.ts`

## 2. Color Validation

- [x] 2.1 Implement `isValidCSSColor()` validator — accepts hex, rgb/rgba, hsl/hsla, oklch, oklab, lch, lab, named CSS colors, transparent, currentColor. Rejects gradients, inherit/initial/unset, objects, arbitrary strings
- [x] 2.2 Wire validation into `addColors()` — throw descriptive error with failing key name and accepted formats
- [x] 2.3 Wire validation into `addColorModes()` — validate alias values reference existing color keys, throw with mode name, alias name, and available keys
- [x] 2.4 Add `CSSColorValue` type constraint to `addColors()` parameter type
- [x] 2.5 Test: valid colors accepted (hex, rgb, oklch, transparent, currentColor), invalid rejected (gradients, objects, arbitrary strings), error messages include key names

## 3. Plugin Manifest Consumption

- [x] 3.1 Update `evaluateThemeObject()` in `theme-evaluator.ts` — read from `theme.manifest` property instead of re-flattening and var() pattern-matching
- [x] 3.2 Add fallback path in `evaluateThemeObject()` — if no `.manifest` property, fall back to current behavior with deprecation warning
- [x] 3.3 Verify `scalesJson`, `variableMapJson`, `variableCss` output matches current behavior when sourced from manifest
- [ ] 3.4 Remove the var() string scanning code path (after manifest path is verified correct — deferred to after full pipeline verification)

## 4. Namespace Prefix — Plugin Config

- [x] 4.1 Add `prefix` option to `AnimusExtractOptions` interface — optional string
- [x] 4.2 Add `layers` option to `AnimusExtractOptions` interface — optional string array
- [x] 4.3 Implement layer order validation at `configResolved` — extract Animus layer subsequence, verify relative ordering, throw descriptive error on violation, verify all 6 Animus layers present when `layers` is provided
- [x] 4.4 Apply prefix to variable map before passing to Rust — O(n) pre-processing pass: `--color-X` → `--{prefix}-color-X`
- [x] 4.5 Build layer name array from config — if `layers` provided use it, otherwise generate default (prefixed or unprefixed)
- [x] 4.6 Emit full `@layer` declaration from `layers` config in virtual CSS module

## 5. Namespace Prefix — Rust Extraction

- [x] 5.1 Update `analyze_project()` signature — add prefix parameter (or include in manifest JSON)
- [x] 5.2 Update `transform_file()` signature — not needed: transform_file consumes manifest which already has prefixed class names
- [x] 5.3 Apply prefix to class name generation — `{prefix}-{Component}-{hash}` instead of `animus-{Component}-{hash}`
- [x] 5.4 Receive layer names from plugin — JS overrides @layer declaration when custom layers configured, Rust default unchanged
- [x] 5.5 Verify unprefixed path produces identical output to current behavior (no regression)

## 6. Rust FFI Consolidation

- [x] 6.1-6.5 SKIPPED — FFI consolidation deferred. Prefix flows as clean `Option<String>` param. Current 8-param signature is well-typed and documented. Consolidation would reduce type safety for no feature benefit.

## 7. Verification & Showcase

- [x] 7.1 Run `bun run verify` — 214 tests pass, types clean, biome clean
- [x] 7.2 Run `bun run verify:full` — Rust build + showcase build succeeds (14.30KB CSS, 271.61KB JS)
- [x] 7.3 Verify showcase output unchanged when no prefix configured — showcase builds identically, 115 canary tests pass
- [x] 7.4 Test showcase with `prefix: 'exc'` — verified: `exc-FireLine-*`, `--exc-color-ember`, zero `animus-` leakage
- [x] 7.5 Test showcase with `layers` config including consumer layers — verified: `reset, global, base, variants, states, system, custom, overrides` order established
