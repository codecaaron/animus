## 1. ThemeBuilder — addContextualVars Method

- [x] 1.1 Add `#contextualVars` private field (`Map<string, Record<string, string>>`) to ThemeBuilder class
- [x] 1.2 Copy `#contextualVars` in `#checkpoint` alongside `#emittedScales`
- [x] 1.3 Implement `addContextualVars<Scale extends keyof T & string, Vars extends Record<string, string>>` method — phantom type merge via `#checkpoint`, store vars in `#contextualVars` map
- [x] 1.4 Add runtime ordering guard — throw if scale does not exist in theme at runtime
- [x] 1.5 Include `_contextualVars` in the theme object produced by `.build()` — serialize the `#contextualVars` map into the theme output

## 2. Type System Integration

- [x] 2.1 Add type test: `addContextualVars` with valid scale compiles, var names appear in `keyof TokenScales<Theme>['colors']`
- [x] 2.2 Add type test: `addContextualVars` with nonexistent scale produces type error
- [x] 2.3 Add type test: contextual var name accepted as value for any color-scale prop (`bg`, `borderColor`, `color`, `fill`)
- [x] 2.4 Add type test: contextual var name NOT accepted for non-color-scale props (`fontSize`, `p`)
- [x] 2.5 Verify no `as const` needed — object-key narrowing works with plain object literal

## 3. Prop Interface — currentVar Field

- [x] 3.1 Add optional `currentVar?: string` to `Prop` interface in `config.ts`
- [x] 3.2 Add `currentVar: '--current-bg'` to `bg` prop config in `groups/index.ts`
- [x] 3.3 Include `currentVar` in system serialization (`SystemBuilder.serialize()`)

## 4. Theme Serialization

- [x] 4.1 Include `contextualVars` registry in `evaluateTheme` output alongside `scalesJson` and `variableMapJson`
- [x] 4.2 Pass contextual vars registry through vite plugin to Rust extractor

## 5. Rust Extractor — Contextual Var Resolution

- [x] 5.1 Parse contextual vars registry from theme data in Rust (`theme_resolver.rs`)
- [x] 5.2 Add `contextual_vars` to resolver context struct — accessible to `resolve_value`, `resolve_flat_styles`, `resolve_single_alias`
- [x] 5.3 Add resolution path: token manifest first, then contextual vars registry, then raw passthrough. When value matches a contextual var name for its scale, resolve to `var(--name)` using the registry mapping
- [x] 5.4 Add resolution for token ref syntax: `{colors.current-bg}` resolves to `var(--current-bg)` via contextual var registry in `resolve_single_alias`
- [x] 5.5 Add resolution for opacity syntax: `{colors.current-bg/50}` resolves to `color-mix(in srgb, var(--current-bg) 50%, transparent)` (handled by existing alpha modifier logic once contextual var resolves)

## 6. Rust Extractor — Auto-Emission

- [x] 6.1 Add `current_var: Option<String>` field to Rust `PropConfig` struct with Serde deserialization
- [x] 6.2 In `resolve_single_prop`, when prop has `current_var`, push additional `CssDeclaration` with the CSS custom property name and same resolved value
- [x] 6.3 Add self-referential guard: skip emission when resolved value equals the contextual var's own CSS custom property (e.g., `var(--current-bg)` with `currentVar: '--current-bg'`)
- [x] 6.4 Verify emission works across all cascade layers (base, variants, compounds, states, system props)
- [x] 6.5 Verify emission works per-breakpoint for responsive props

## 7. Showcase & Verification

- [x] 7.1 Add `addContextualVars` call to showcase `ds.ts` theme chain for `colors` scale with `current-bg`
- [ ] 7.2 Add showcase component demonstrating contextual var cascade — Card with bg variant, child border + fill tracking via `current-bg`
- [ ] 7.3 Add canary test for contextual var resolution (direct value → `var(--name)`)
- [ ] 7.4 Add canary test for token ref resolution (`{colors.current-bg}` → `var(--current-bg)`)
- [ ] 7.5 Add canary test for auto-emission (bg declaration produces sibling `--current-bg`)
- [ ] 7.6 Add canary test for self-referential guard (bg: 'current-bg' does NOT emit circular `--current-bg`)
- [ ] 7.7 Add canary test for responsive auto-emission (per-breakpoint `--current-bg`)
- [x] 7.8 Run `bun run verify:full` — all tests pass, showcase builds, extraction correct
