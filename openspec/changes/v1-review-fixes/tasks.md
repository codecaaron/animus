## 1. UNITLESS_PROPERTIES dedup (R2)

- [ ] 1.1 Create `packages/extract/pipeline/unitless-properties.ts` with the canonical `UNITLESS_PROPERTIES` Set exported
- [ ] 1.2 Update `packages/extract/pipeline/unit-fallback.ts` to import from shared module instead of inline definition
- [ ] 1.3 Update `packages/extract/pipeline/index.ts` to export `UNITLESS_PROPERTIES` from the shared module
- [ ] 1.4 Update `packages/system/src/runtime/resolveClasses.ts` to import `UNITLESS_PROPERTIES` from `@animus-ui/extract/pipeline`
- [ ] 1.5 Verify the 4 divergent properties (`box-flex`, `box-flex-group`, `box-ordinal-group`, `flex-order`) are in the shared set
- [ ] 1.6 Run unit tests to confirm no regressions

## 2. resolveTokenRefs opacity fix (R5)

- [ ] 2.1 Fix `resolveTokenRefs` in `packages/system/src/theme/createTheme.ts` — implement `color-mix` for both raw-value and `var()` cases
- [ ] 2.2 Handle zero opacity (`/0`) → return `transparent`
- [ ] 2.3 Add test case for opacity modifier in theme scale cross-reference
- [ ] 2.4 Add test case for opacity modifier with emitted scale var() reference

## 3. applyPrefix contextualVarsJson (R4)

- [ ] 3.1 Add `contextualVarsJson` as optional parameter to `applyPrefix` in `packages/extract/pipeline/prefix.ts`
- [ ] 3.2 Prefix contextual var names: `--current-{name}` → `--{prefix}-current-{name}`
- [ ] 3.3 Prefix var() references within contextualVarsJson
- [ ] 3.4 Update both plugin call sites (vite-plugin, next-plugin) to pass contextualVarsJson to applyPrefix
- [ ] 3.5 Add test cases for contextualVarsJson prefixing in `_integration/__tests__/post-processing.test.ts`

## 4. loadSystem error message + export detection (A2)

- [ ] 4.1 Update vite-plugin `loadSystem` subprocess to iterate all exports and find any with `.toConfig()`
- [ ] 4.2 Update next-plugin `loadSystem` subprocess with same detection logic
- [ ] 4.3 Fix error message: `.serialize()` → `.toConfig()`
- [ ] 4.4 Include found export names in error diagnostic when no candidate found
- [ ] 4.5 Throw with candidate list when multiple exports satisfy `.toConfig()`
