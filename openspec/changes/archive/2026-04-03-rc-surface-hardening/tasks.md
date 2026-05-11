## 1. Transform return type guard

- [x] 1.1 Add `CustomPropConfig` interface to `system/src/types/config.ts` — extends Prop, narrows transform return to `string | number`
- [x] 1.2 Update `.props()` method in `system/src/Animus.ts` to use `Record<string, CustomPropConfig>`
- [x] 1.3 Update `.props()` method in `system/src/AnimusExtended.ts` to use `Record<string, CustomPropConfig>`
- [x] 1.4 Export `CustomPropConfig` from `system/src/index.ts`
- [x] 1.5 Add type tests: positive (string/number return compiles) + negative (CSSObject return rejected)
- [x] 1.6 Verify all packages build clean (`bun run build:ts`)
- [x] 1.7 Verify all tests pass (`bun test` + `bun run test:types`)

## 2. CI publish pipeline

- [x] 2.1 Add `properties` to version-bump loop in `.github/workflows/ci.yaml` (line 149)
- [x] 2.2 Add `properties` to TS publish loop in `.github/workflows/ci.yaml` (line 231)
- [x] 2.3 Verify properties is first in both loops (dependency order)

## 3. Legacy package isolation

- [x] 3.1 Add `"private": true` to `packages/ui/package.json`
- [x] 3.2 Add `"private": true` to `packages/runtime/package.json`

## 4. Documentation

- [x] 4.1 Update `packages/system/CLAUDE.md` to document `@animus-ui/properties` runtime dependency
