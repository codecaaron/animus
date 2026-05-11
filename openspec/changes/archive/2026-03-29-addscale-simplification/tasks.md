## 1. addScale Config Object API

- [x] 1.1 Define `ScaleConfig` type in `packages/system/src/types/config.ts` — `{ name: Key, values: Record<string | number, string | number>, emit?: boolean }`
- [x] 1.2 Add `EmittedScales<T>` type utility that extracts scale names where `emit: true` (including colors from `addColors`)
- [x] 1.3 Add `ScaleTokenRef<T>` template literal type — `{${EmittedScales<T> & string}.${string}}` constrained to emitted scales only
- [x] 1.4 Update `addScale` method signature in `packages/system/src/theme/createTheme.ts` — accept `ScaleConfig` instead of `(name, factory)`
- [x] 1.5 Update `addScale` implementation — extract `name`, `values`, `emit` from config object, call `flattenScale(values)` directly (no factory invocation)
- [x] 1.6 When `emit: true`, call `serializeTokens` inline within `addScale` (same logic as current `createScaleVariables`)
- [x] 1.7 Track emitted scale names on the builder instance for token ref resolution in `build()`

## 2. Remove createScaleVariables

- [x] 2.1 Deprecate `createScaleVariables` method on `ThemeBuilder` class (retained for backward compat, @deprecated tag)
- [x] 2.2 Remove associated type signatures and return type computations
- [x] 2.3 Update `packages/showcase/src/ds.ts` — remove `.createScaleVariables('sizes')`, add `emit: true` to sizes addScale config

## 3. Token Ref Resolution in Scale Values

- [x] 3.1 Add `resolveTokenRefs(value: string, theme: T)` utility in `packages/system/src/theme/` — parses `{scale.key}` patterns, looks up resolved value in theme
- [x] 3.2 Integrate token ref resolution into `build()` — after all scales collected, resolve refs in all scale values
- [x] 3.3 Handle token refs in emitted scale variable declarations — if a value contained a ref, the CSS variable declaration gets the resolved value
- [x] 3.4 Add warning for unresolvable token refs (referenced scale doesn't exist or isn't emitted)
- [x] 3.5 Add warning for self-referential token refs (circular references within a scale)

## 4. Migrate Consumers

- [x] 4.1 Update `packages/showcase/src/ds.ts` — convert all 13 `addScale` calls from `(name, factory)` to `{ name, values }` config objects
- [x] 4.2 Update `packages/_docs/theme.ts` — N/A, uses legacy `@animus-ui/theming` package (different API)
- [x] 4.3 Update `packages/system/__tests__/test-system.ts` — convert test fixture scales to config objects
- [x] 4.4 Remove factory form from `packages/theming/src/utils/createTheme.ts` — N/A, legacy package, not touching

## 5. Type Regression Tests

- [x] 5.1 Add type tests in `packages/system/__tests__/types.test-d.tsx` — config object compiles with name, values, emit
- [x] 5.2 Add type test — scale name inferred as literal type in returned builder
- [x] 5.3 Add type test — EmittedScales derives emitted from built theme, EmittedTokenPaths enumerates valid paths
- [x] 5.4 Add type test — non-emitted scale excluded from EmittedScales/EmittedTokenPaths
- [x] 5.5 Add type test — accumulated theme type includes all added scales

## 6. Unit Tests

- [x] 6.1 Update `packages/system/__tests__/theme.test.ts` — addScale with config object produces correct theme shape
- [x] 6.2 Test emit: true produces CSS variable declarations and var() references in scale values
- [x] 6.3 Test emit: false (default) produces raw values with no CSS variables
- [x] 6.4 Test token ref resolution in scale values — `{colors.text}` resolves to `var(--color-text)`
- [x] 6.5 Test nested scale values are flattened correctly with config object
- [x] 6.6 Test manifest output is identical before and after migration (tokenMap, variableMap shapes)

## 7. Verification

- [x] 7.1 Run `bun run verify` — TS builds, all tests pass, types clean, biome check (pre-existing CascadeLayer type errors only)
- [x] 7.2 Run `bun run verify:showcase` — showcase builds with migrated ds.ts, extraction produces correct CSS
- [ ] 7.3 Verify dev server — scale values resolve correctly, emitted scales produce CSS variables in :root
