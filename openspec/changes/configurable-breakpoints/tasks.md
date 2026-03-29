## 1. Type System Foundation

- [ ] 1.1 Replace `Breakpoints<T>` interface in `system/src/types/theme.ts` with `Record<string, number>` in `BaseTheme.breakpoints`
- [ ] 1.2 Replace `Breakpoints<T>` interface in `core/src/types/theme.ts` with `Record<string, number>` in `BaseTheme.breakpoints`
- [ ] 1.3 Redefine `MediaQueryMap<T>` in `system/src/types/props.ts` as conditional mapped type over `Theme['breakpoints']` (augmented → exact keys; unaugmented → open record)
- [ ] 1.4 Remove `MediaQueryArray<T>` and `MediaQueryByKey<T>` from `system/src/types/props.ts`
- [ ] 1.5 Simplify `ResponsiveProp<T>` to `T | MediaQueryMap<T>` (remove array arm)
- [ ] 1.6 Update `MediaQueryCache` type: `map` becomes `Record<string, string>`, remove `array` field (or keep as `string[]` derived from object keys)
- [ ] 1.7 Update `core/src/types/props.ts` to match system types (remove `MediaQueryByKey`, `MediaQueryArray`, update `MediaQueryMap`)
- [ ] 1.8 Fix all downstream type errors from the interface changes (imports, usages of removed types)

## 2. Runtime — Core Package

- [ ] 2.1 Remove `BREAKPOINT_KEYS` constant from `core/src/styles/responsive.ts`
- [ ] 2.2 Rewrite `createMediaQueries()` to iterate `Object.keys(breakpoints)` instead of destructuring fixed keys
- [ ] 2.3 Remove `arrayParser()` and `isMediaArray()` from `core/src/styles/responsive.ts`
- [ ] 2.4 Update `isMediaMap()` to accept breakpoint key set as parameter (or derive from theme)
- [ ] 2.5 Rewrite `createStylist` `getMediaSelectors` (line 169) to derive keys from `theme.breakpoints` dynamically instead of hardcoded array
- [ ] 2.6 Update `createParser.ts` to thread breakpoint keys through the responsive resolution pipeline
- [ ] 2.7 Update `compatTheme.ts` — keep default values `{ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 }` but type as `Record<string, number>`

## 3. Theming Package

- [ ] 3.1 Update `ThemeWithBreakpoints<Bps extends Breakpoints>` to `ThemeWithBreakpoints<Bps extends Record<string, number>>` in `theming/src/core/ThemeBuilder.ts`
- [ ] 3.2 Update `ThemeWithRawColors` generic constraint from `extends Breakpoints` to `extends Record<string, number>`
- [ ] 3.3 Update `ThemeUnitialized.addBreakpoints` constraint to `extends Record<string, number>`
- [ ] 3.4 Remove `Breakpoints` import from theming package

## 4. System Package — createTheme

- [ ] 4.1 Update `createTheme()` in `system/src/theme/createTheme.ts` — relax generic constraint from `extends AbstractTheme` (which requires `Breakpoints`) to accept `Record<string, number>` for breakpoints
- [ ] 4.2 Add runtime validation in `createTheme()`: all breakpoint values must be non-negative numbers
- [ ] 4.3 Verify `ThemeBuilder.build()` serialization still works (it already serializes breakpoints key-agnostically via `serializeTokens`)

## 5. Rust Extraction

- [ ] 5.1 Delete `BREAKPOINT_KEYS` constant from `theme_resolver.rs`
- [ ] 5.2 Change `is_responsive_value()` signature to accept `breakpoint_keys: &HashSet<String>`
- [ ] 5.3 Update `is_responsive_value()` logic: check if all object keys are `_` or in the provided `breakpoint_keys` set
- [ ] 5.4 Thread breakpoint key set from `extract_breakpoints()` through `resolve_styles()` → `is_responsive_value()`
- [ ] 5.5 Update all call sites of `resolve_styles()` and `is_responsive_value()` to pass the breakpoint key set
- [ ] 5.6 Verify `extract_breakpoints()` is already key-agnostic (it reads `breakpoints.*` prefix — should work as-is)
- [ ] 5.7 Build Rust crate and verify compilation

## 6. Integration & Tests

- [ ] 6.1 Update any responsive array syntax in showcase components to object syntax
- [ ] 6.2 Update test fixtures that use array syntax or hardcode breakpoint keys
- [ ] 6.3 Add canary test: custom breakpoint keys (e.g., `{ mobile: 480, tablet: 768, desktop: 1024 }`) produce correct media queries
- [ ] 6.4 Verify existing canary tests still pass (object syntax responsive props should be unchanged)
- [ ] 6.5 Run `bun run verify:full` — full pipeline proof

## 7. Type Verification

- [ ] 7.1 Verify `declare module` augmentation with custom breakpoint keys produces correct `ResponsiveProp` types
- [ ] 7.2 Verify unaugmented `Theme` falls back to open record (any string key accepted)
- [ ] 7.3 Run `bun run test:types` — zero type errors
- [ ] 7.4 Spot-check showcase: responsive props in components type-check with `{ xs, sm, md, lg, xl }` keys via augmented Theme
