## 1. Constructor & addBreakpoints

- [x] 1.1 Change `createTheme()` to accept no arguments; initialize empty `#theme`
- [x] 1.2 Add `addBreakpoints()` method with validation (non-negative numbers), returns next type-state
- [x] 1.3 Update all call sites: showcase `ds.ts`, test-ds `system.ts`, `theme.test.ts`, next-test-app `ds.ts`

## 2. Type-State Chain

- [x] 2.1 Define type-state classes/interfaces: ThemeEmpty → ThemeWithBreakpoints → ThemeWithColors → ThemeWithModes → ThemeComplete
- [x] 2.2 Each `add*` method returns the next type-state, exposing only methods valid at that stage
- [x] 2.3 `addColorModes` only available after `addColors` (type-level enforcement)
- [x] 2.4 `addScale` available from ThemeWithColors onward (can reference emitted colors)
- [x] 2.5 `declareContextualVars` available from ThemeWithColors onward (annotates existing scales)
- [x] 2.6 `build()` available from ThemeWithBreakpoints onward (minimal viable theme)

## 3. Nested Color Storage

- [x] 3.1 Remove `flattenScale(colors)` and `serializeTokens()` from `addColors()` — store raw nested colors on `#theme.colors` via deep merge
- [x] 3.2 Remove `_tokens.colors` and `_variables.root` assembly from `addColors()`
- [x] 3.3 Verify color validation (`validateColors`) works on nested input

## 4. Nested Scale Storage

- [x] 4.1 Remove `flattenScale(values)` from `addScale()` — store raw values on `#theme[name]`
- [x] 4.2 Remove conditional `serializeTokens()` from `addScale()` for `emit: true`
- [x] 4.3 Track emit metadata in `#emittedScales` (already exists, verify sufficient)

## 5. Nested Color Mode Storage

- [x] 5.1 Remove `mapValues(modeConfig, flattenScale)` from `addColorModes()` — store raw nested mode aliases
- [x] 5.2 Refactor `validateModeAliases` to walk nested color structure via dot-path traversal instead of flat key lookup
- [x] 5.3 Refactor `_getColorValue` / mode color resolution to use dot-path traversal of nested colors
- [x] 5.4 Update mode alias syntax in showcase `ds.ts` and test fixtures: `'gray-50'` → `'gray.50'`

## 6. Dot-Path Infrastructure

- [x] 6.1 Create `walkDotPath(obj, path)` utility: resolves `'gray.50'` against `{ gray: { 50: '#fafafa' } }` → `'#fafafa'`
- [x] 6.2 Update `LiteralPaths` to use `.` separator (or create `DotPaths` variant)
- [x] 6.3 Update token ref resolution: `{colors.gray.50}` splits scale name on first `.`, traverses rest as nested path
- [x] 6.4 Update token ref regex if needed to handle multi-segment dot-paths

## 7. Build-Time Flatten Pass

- [x] 7.1 Create `flattenTheme(theme, emittedScales)` — walks nested theme, produces flat token map (dot-path keys), CSS variable declarations (dash-join names), mode CSS blocks
- [x] 7.2 Integrate into `build()` replacing inline `_variables`/`_tokens` assembly
- [x] 7.3 Move `resolveThemeTokenRefs` to operate on build-time flattened output via nested traversal — no mutation of stored data
- [x] 7.4 Assemble manifest from flattened output

## 8. Composition: from()

- [x] 8.1 Add `.from(builtTheme)` method — reads enumerable properties from a built theme, seeds `#theme` via deep merge
- [x] 8.2 `.from()` advances type-state to extension mode (all `add*` methods available)
- [x] 8.3 Deep merge semantics: consumer wins on key conflict for colors, scale-level replacement for named scales

## 9. Built Theme Shape

- [x] 9.1 Remove `_variables`, `_tokens`, `_getColorValue` from built theme
- [x] 9.2 Built theme exposes nested data as enumerable: `colors`, `breakpoints`, scales, `modes`, `mode`
- [x] 9.3 Attach `varRef(tokenPath)` as non-enumerable — takes dot-path, returns var() with dash-join name
- [x] 9.4 Verify `manifest` and `serialize()` remain non-enumerable

## 10. Terminology Renames

- [x] 10.1 `addContextualVars` → `declareContextualVars`
- [x] 10.2 `updateScale` → `extendScale`
- [x] 10.3 `ds.serialize()` → `ds.toConfig()` on SystemBuilder + SystemInstance
- [x] 10.4 Update all call sites for renames (vite-plugin, next-plugin, tests, showcase)
- [x] 10.5 Move `flattenScale` and `serializeTokens` to internal (remove from index.ts exports)

## 11. Type Updates

- [x] 11.1 `TokenScales<T>` — exclude `breakpoints`, `modes`, `mode` without `_` prefix check
- [x] 11.2 `EmittedScales<T>` — use `Emitted` type param instead of `var(--*)` value check
- [x] 11.3 Update `build()` return type: remove `PrivateThemeKeys`, add `varRef()` signature
- [x] 11.4 `addColorModes` type: mode alias keys become `keyof LiteralPaths<T['colors'], '.'>` (dot-path flat keys from nested)
- [x] 11.5 Verify `ThemedScale` and `ThemedCSSProps` resolve correctly with nested theme + dot-path

## 12. Tests — Storage & Build

- [x] 12.1 Update `buildTestTheme()` fixture to new signature
- [x] 12.2 Replace `theme._variables` assertions with `theme.manifest` assertions
- [x] 12.3 Replace `theme._tokens` assertions with `theme.manifest.tokenMap` or nested property assertions
- [x] 12.4 Update complete build output snapshot: nested shape, no `_variables`/`_tokens`
- [x] 12.5 Test: `theme.colors` is nested after build
- [x] 12.6 Test: dot-path token refs resolve correctly (`{colors.gray.50}` → resolved value)

## 13. Tests — Serialization Parity

- [x] 13.1 Test: `serialize().scalesJson` from nested theme uses dot-path keys
- [x] 13.2 Test: `serialize().variableCss` produces dash-join CSS variable names from nested input
- [x] 13.3 Test: `serialize().variableMapJson` maps dot-path keys to dash-join CSS var names
- [x] 13.4 Test: mode CSS blocks have correct dash-join variable names

## 14. Tests — Composition

- [x] 14.1 Test: `.from(libTokens).build()` round-trip — serialize() matches original
- [x] 14.2 Test: `.from(libTokens).addColors({ brand: {...} })` — deep merge produces combined tokens
- [x] 14.3 Test: selective spread — `.addColors({ ...libTokens.colors })` without `.from()`
- [x] 14.4 Test: `.from()` then `.addScale()` replaces scale entirely

## 15. Tests — Type-State

- [x] 15.1 Type test: `addColorModes` before `addColors` produces compile error
- [x] 15.2 Type test: `addScale` after `addColors` compiles
- [x] 15.3 Type test: `.from()` then any `add*` compiles
- [x] 15.4 Type test: `build()` available from ThemeWithBreakpoints onward

## 16. Tests — varRef

- [x] 16.1 Test: `varRef('colors.gray.50')` returns `'var(--color-gray-50)'`
- [x] 16.2 Test: `varRef('space.8')` returns `'0.5rem'` for non-emitted
- [x] 16.3 Test: `varRef` is non-enumerable

## 17. Integration & Cleanup

- [ ] 17.1 Run `bun run verify` — build, test, biome check pass
- [ ] 17.2 Run `bun run verify:showcase` — showcase builds with correct CSS
- [x] 17.3 Update downstream token ref syntax in showcase/test-ds: `{colors.gray-50}` → `{colors.gray.50}`
- [x] 17.4 Update vite-plugin and next-plugin to call `ds.toConfig()` instead of `ds.serialize()`
- [x] 17.5 Update Rust crate token ref parser if needed (dot-path splitting)
