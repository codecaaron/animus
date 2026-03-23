## 1. Legacy Removal

- [x] 1.1 Delete `packages/core/src/legacy/` directory (10 files)
- [x] 1.2 Remove `export * from './legacy/core'` from `packages/core/src/index.ts`
- [x] 1.3 Update or archive `packages/_integration/__tests__/component.test.tsx` and `variance.test.ts` to remove `animusProps` usage
- [x] 1.4 Remove `@emotion/is-prop-valid` from `packages/core/package.json` dependencies
- [x] 1.5 Verify build: `cd packages/core && bun run build`

## 2. Emotion Type Removal

- [x] 2.1 Remove `declare module '@emotion/react'` from `packages/core/src/types/theme.ts` — replace with standalone `BaseTheme` interface containing the shape the prop system needs (breakpoints, scale keys)
- [x] 2.2 Update `packages/core/src/types/props.ts` to use the standalone interface instead of Emotion's `Theme`
- [x] 2.3 Remove `@emotion/react` and `@emotion/styled` from `packages/core/package.json` dependencies — DEFERRED: restored, runtime still uses styled()
- [x] 2.4 Update `packages/theming/src/utils/serializeTokens.ts` to accept `{ breakpoints: Record<string, string> }` instead of Emotion's `Theme`
- [x] 2.5 Remove `@emotion/react` and `@emotion/styled` from `packages/theming/package.json` dependencies — DEFERRED: restored, still needed transitionally
- [x] 2.6 Run `tsc --noEmit` across core, theming, extract, runtime, vite-plugin, showcase, smoke-test to verify no type breakage

## 3. createTransform Utility

- [x] 3.1 Create `packages/core/src/transforms/createTransform.ts` with `createTransform(name, fn)` function and `TransformFn`/`NamedTransform` types
- [x] 3.2 Update `packages/core/src/transforms/size.ts` — wrap `size` and `percentageOrAbsolute` exports with `createTransform`
- [x] 3.3 Update `packages/core/src/transforms/border.ts` — wrap `borderShorthand` with `createTransform`
- [x] 3.4 Update `packages/core/src/transforms/grid.ts` — wrap `gridItemRatio` and `gridItem` with `createTransform`
- [x] 3.5 Export `createTransform` from `packages/core/src/transforms/index.ts` and `packages/core/src/index.ts`
- [x] 3.6 Verify all 4 built-in transforms have `.transformName` set correctly

## 4. Serialization Update

- [x] 4.1 Replace `TRANSFORM_MAP` in `packages/core/src/config.ts` with `.transformName ?? .name` fallback in `getExtractConfig()`
- [x] 4.2 Delete the `TRANSFORM_MAP` constant and its imports
- [x] 4.3 Verify `getExtractConfig()` output matches previous output for all built-in transforms (canary snapshot test)

## 5. Rust Transform Removal

- [x] 5.1 Modify `packages/extract/src/theme_resolver.rs` to emit raw values + transform name metadata instead of calling `apply_transform()`
- [x] 5.2 Update manifest/output format to carry transform metadata per declaration
- [x] 5.3 Delete `packages/extract/src/transforms.rs` (~265 lines)
- [x] 5.4 Remove `mod transforms` from `packages/extract/src/lib.rs` and all `use transforms::*` references
- [x] 5.5 Update Rust unit tests to expect raw values instead of transformed values for props with transforms
- [x] 5.6 Build the NAPI addon: `cd packages/extract && bun run build`

## 6. Vite Plugin Transform Post-Processing

- [x] 6.1 Add transform registry construction at `buildStart` — load config module, enumerate all transforms by `.transformName`, build `Map<string, TransformFn>`
- [x] 6.2 Implement post-processing step after `analyze_project()` — walk manifest transform metadata, look up functions, apply, substitute final CSS values
- [x] 6.3 Handle unknown transform names: emit warning in extraction report, use raw value as fallback
- [x] 6.4 Update the virtual CSS module content to use post-processed CSS

## 7. Integration Verification

- [x] 7.1 Update canary snapshot test (`packages/extract/tests/canary.test.ts`) — CSS output now contains post-processed transform values (same final CSS, different pipeline path)
- [x] 7.2 Run full canary test suite: `cd packages/extract && bun test`
- [x] 7.3 Build showcase app: `cd packages/showcase && bun run build`
- [x] 7.4 Build smoke test: `cd packages/smoke-test && bun run build`
- [x] 7.5 Verify `bun install` succeeds with updated dependency graphs
