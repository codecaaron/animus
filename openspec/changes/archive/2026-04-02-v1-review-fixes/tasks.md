## ~~1. UNITLESS_PROPERTIES dedup (R2)~~ — Subsumed by `properties-package` change

## 2. resolveTokenRefs opacity fix (R5)

- [x] 2.1 Fix `resolveTokenRefs` in `packages/system/src/theme/createTheme.ts` — implement `color-mix` for both raw-value and `var()` cases
- [x] 2.2 Handle zero opacity (`/0`) → return `transparent`
- [x] 2.3 Add test case for opacity modifier in theme scale cross-reference (raw value + emitted var())
- [x] 2.4 Add test case for opacity modifier with emitted scale var() reference + zero opacity

## 3. applyPrefix contextualVarsJson (R4)

- [x] 3.1 Add `contextualVarsJson` as optional parameter to `applyPrefix` in `packages/extract/pipeline/prefix.ts`
- [x] 3.2 Prefix contextual var names: `current-{name}` → `{prefix}-current-{name}`
- [x] 3.3 N/A — var() references within contextualVarsJson values handled by existing CSS regex pass
- [x] 3.4 Update both plugin call sites (vite-plugin, next-plugin) to pass contextualVarsJson to applyPrefix
- [x] 3.5 Add test cases for contextualVarsJson prefixing in `_integration/__tests__/post-processing.test.ts`

## 4. loadSystem error message + export detection (A2)

- [x] 4.1 Update vite-plugin `loadSystem` subprocess to iterate all exports and find any with `.toConfig()`
- [x] 4.2 Update next-plugin `loadSystem` subprocess with same detection logic
- [x] 4.3 Fix error message: `.serialize()` → `.toConfig()` (replaced with diagnostic listing exports)
- [x] 4.4 Include found export names in error diagnostic when no candidate found
- [x] 4.5 Throw with candidate list when multiple exports satisfy `.toConfig()`
