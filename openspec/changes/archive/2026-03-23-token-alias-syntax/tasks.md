## 1. Verify Assumptions (Red Team Flags)

- [x] 1.1 Read `packages/theming/src/utils/flattenScale.ts` and `packages/vite-plugin/src/theme-evaluator.ts` flattenScale — confirm both produce identical keys for nested scales with `_` defaults. Document any divergence.
- [x] 1.2 Read `packages/theming/src/utils/serializeTokens.ts` — understand CSS variable naming convention and confirm the variable-name → token-path inversion is lossless.
- [x] 1.3 Read `packages/vite-plugin/src/resolve-transforms.ts` — understand its role in the pipeline and identify any interaction with token alias resolution.
- [x] 1.4 Test with the real docs theme (`packages/_docs/theme.ts`): verify that `_variables` contains entries for all `createScaleVariables()` scales, and confirm which scales do NOT have variables.

## 2. Theme Serialization (Vite Plugin)

- [x] 2.1 Add `buildVariableMap(theme)` function in `theme-evaluator.ts` that iterates `theme._variables` scopes and builds a `{ "token.path": "--css-var-name" }` map. Handle the key format conversion (CSS var name → token path).
- [x] 2.2 Update `evaluateThemeObject()` return type to include `variablesMap: string` (JSON) alongside existing `scalesJson` and `variableCss`.
- [x] 2.3 Update `index.ts` plugin to pass the variable-name map JSON to Rust `extract()` and `analyze_project()` as an additional argument.

## 3. Rust: NAPI Signature Update

- [x] 3.1 Add `variable_map_json: String` parameter to `extract()` and `analyze_project()` NAPI functions in `lib.rs`.
- [x] 3.2 Deserialize variable map as `HashMap<String, String>` and pass to theme resolver alongside the existing flat theme.
- [x] 3.3 Update `transform_file()` if it needs access to the variable map (check whether transform phase needs alias data).

## 4. Rust: Token Alias Resolution

- [x] 4.1 Add `resolve_token_aliases(value: &str, theme: &FlatTheme, variables: &HashMap<String, String>) -> (String, Vec<AliasWarning>)` function in `theme_resolver.rs`. Scans string for `{...}` patterns, resolves each.
- [x] 4.2 Implement dot-path-to-flat-key conversion: split on dots, first segment = scale, rest joined with hyphens. `{colors.pink.600}` → `"colors.pink-600"`.
- [x] 4.3 Implement alpha modifier parsing: split alias on `/`, parse trailing integer as opacity percentage (0-100).
- [x] 4.4 Implement variable-aware resolution: check variable map first (→ `var(--name)`), fall back to flat value map (→ literal), emit warning if neither matches.
- [x] 4.5 Implement alpha wrapping: `color-mix(in srgb, <resolved> N%, transparent)`. Handle edge cases: `/100` → no wrapper, `/0` → `transparent`.
- [x] 4.6 Integrate `resolve_token_aliases` into `resolve_single_prop` — call it on string values after existing scale resolution, before emitting CSS declarations.

## 5. Rust: Diagnostics

- [x] 5.1 Define `AliasWarning` struct with `token_path: String` and propagate warnings through the resolution pipeline to `ExtractionResult.errors` with `[alias]` prefix format.

## 6. Testing

- [x] 6.1 Add Rust unit tests in `theme_resolver.rs`: dot-path conversion, basic alias resolution, alpha modifier, multiple aliases, unresolved alias warning, variable vs literal resolution.
- [x] 6.2 Create test fixture `packages/extract/tests/fixtures/token-alias.tsx` with components using token alias syntax: simple alias, compound values, alpha modifier, multiple aliases, unresolved alias.
- [x] 6.3 Add canary test cases in `canary.test.ts`: verify CSS output contains resolved token values, verify alias warnings in errors, verify alpha produces color-mix().
- [x] 6.4 Verify existing canary tests still pass — token alias changes must not regress the existing pipeline.

## 7. Documentation

- [x] 7.1 Update the canary test's theme fixture to include a variable-name map, reflecting the new serialization format.
