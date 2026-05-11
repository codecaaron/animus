## 1. Fix assembleManifest Breakpoints Gap

- [x] 1.1 In `packages/system/src/theme/createTheme.ts`, update `assembleManifest()` to include `breakpoints` in `tokenMap`. Remove the `scaleName === 'breakpoints'` skip from the assembly loop. Breakpoint entries become `"breakpoints.xs": "480"` etc.
- [x] 1.2 Write test in `packages/system/__tests__/theme.test.ts` — verify `tokens.manifest.tokenMap` includes breakpoint entries matching `"breakpoints.<key>": "<value>"` for all configured breakpoints.

## 2. Theme Evaluate Method

- [x] 2.1 Add `EvaluatedTheme` type to `packages/system/src/types/theme.ts` — `{ scalesJson: string; variableMapJson: string; variableCss: string; contextualVarsJson: string }`.
- [x] 2.2 Add `.evaluate()` method via `Object.defineProperty` in `ThemeBuilder.build()` (next to `.manifest`). Reads from `manifest` fields, returns `EvaluatedTheme`. Non-enumerable, non-configurable.
- [x] 2.3 Add `evaluate` to the build output type so TypeScript knows about it. Use intersection or interface augmentation so `.evaluate()` is callable without casting.
- [x] 2.4 Write test in `packages/system/__tests__/theme.test.ts` — call `tokens.evaluate()`, verify all 4 JSON strings parse correctly, verify non-enumerable, verify scalesJson includes breakpoints.
- [x] 2.5 Cross-check test: build the legacy `evaluateThemeObjectLegacy` output from the same theme (import from vite-plugin or replicate the flatten logic in-test) and assert `.evaluate()` output is byte-identical for scalesJson, variableMapJson, contextualVarsJson. variableCss comparison verifies structural equivalence (same variables, same modes).

## 3. Pipeline Subpath Export

- [x] 3.1 Create `packages/system/src/pipeline/index.ts` — export `resolveGlobalStyles`, `camelToKebab`, `resolveValue`, `EvaluatedTheme` type, re-export `SerializedConfig` type from `SystemBuilder`.
- [x] 3.2 Move `resolveGlobalStyles`, `resolveValue`, `camelToKebab` functions from `packages/vite-plugin/src/theme-evaluator.ts` to `packages/system/src/pipeline/resolve-global-styles.ts`. Keep function signatures identical.
- [x] 3.3 Add `./pipeline` subpath export to `packages/system/package.json` (types + import, matching `./groups` pattern).
- [x] 3.4 Add `./src/pipeline/index.ts` to `tsdown.config.ts` entry array (alongside `./src/index.ts` and `./src/groups/index.ts`).
- [x] 3.5 Run `bun run --filter './packages/system' build` — verify `dist/pipeline/` is produced with correct exports.

## 4. Vite-Plugin Migration

- [x] 4.1 Update `evaluateThemeObject` in `packages/vite-plugin/src/theme-evaluator.ts` — check for `.evaluate()` method first, call it directly. Fall back to `evaluateThemeObjectLegacy()` (rename existing legacy path). Note: vite-plugin subprocess strips `.evaluate()` via JSON serialization, so legacy path remains the production path for now.
- [x] 4.2 Remove `resolveGlobalStyles`, `resolveValue`, `camelToKebab` from `packages/vite-plugin/src/theme-evaluator.ts` — these now live in system/pipeline.
- [x] 4.3 N/A — `resolve-global-styles.ts` is a standalone subprocess script with its own inline resolution logic. Does not import from theme-evaluator.
- [x] 4.4 Remove dead helper functions from theme-evaluator.ts that are only used by the moved code (not the legacy path).

## 5. Verification

- [x] 5.1 Run `bun run test` — all existing tests pass.
- [x] 5.2 Run `bun run verify:full` — full pipeline proof including Rust + showcase.
- [x] 5.3 Grep vite-plugin source for any remaining local implementations of moved functions — zero matches expected (legacy-only helpers are fine).
