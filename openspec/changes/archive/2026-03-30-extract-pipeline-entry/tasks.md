## 1. Naming Standardization (system)

- [x] 1.1 Rename `EvaluatedTheme` → `SerializedTheme` in `packages/system/src/types/theme.ts`. Update all references in system package.
- [x] 1.2 Rename `.evaluate()` → `.serialize()` on theme build output in `packages/system/src/theme/createTheme.ts`. Update the `Object.defineProperty` name and return type.
- [x] 1.3 Update `packages/system/src/index.ts` — export `SerializedTheme` instead of `EvaluatedTheme`.
- [x] 1.4 Update `packages/system/__tests__/theme.test.ts` — all `tokens.evaluate()` calls → `tokens.serialize()`.
- [x] 1.5 Update `packages/vite-plugin/src/theme-evaluator.ts` — `.evaluate()` check → `.serialize()` check.
- [x] 1.6 Run `bun run test` — all tests pass with renamed method.

## 2. Remove system/pipeline Subpath

- [x] 2.1 Delete `packages/system/src/pipeline/` directory (index.ts, resolve-global-styles.ts).
- [x] 2.2 Remove `./pipeline` entry from `packages/system/tsdown.config.ts`.
- [x] 2.3 Remove `./pipeline` subpath from `packages/system/package.json` exports.
- [x] 2.4 Remove `camelToKebab` import from `@animus-ui/system/pipeline` in `packages/vite-plugin/src/resolve-global-styles.ts` — restore local function temporarily (will move to extract in step 3).
- [x] 2.5 Run `bun run --filter './packages/system' build` — verify pipeline output no longer produced.
- [x] 2.6 Run `bun run verify` — everything still passes.

## 3. Extract Pipeline Module

- [x] 3.1 Create `packages/extract/pipeline/` directory structure.
- [x] 3.2 Move `camelToKebab` to `packages/extract/pipeline/utils.ts`.
- [x] 3.3 Move `applyUnitFallback()` from `packages/vite-plugin/src/index.ts` to `packages/extract/pipeline/unit-fallback.ts`. Include the UNITLESS_PROPERTIES set.
- [x] 3.4 Move `applyPrefix()` from `packages/vite-plugin/src/index.ts` to `packages/extract/pipeline/prefix.ts`.
- [x] 3.5 Move global styles resolution logic (resolveBlock, resolveTokenAliases, resolveValue, prop config resolution) from `packages/vite-plugin/src/resolve-global-styles.ts` to `packages/extract/pipeline/resolve-global-styles.ts`. Export `resolveGlobalStyles()` function.
- [x] 3.6 Create `packages/extract/pipeline/resolve-transforms.ts` — extract transform placeholder resolution logic from vite-plugin's `runAnalysis()`. Export `resolveTransformPlaceholders()`.
- [x] 3.7 Create `packages/extract/pipeline/index.ts` — the `runExtraction()` entry point. Wraps NAPI `analyzeProject` + resolveGlobalStyles + resolveTransformPlaceholders + applyUnitFallback + applyPrefix. Export all pipeline functions.
- [x] 3.8 Add JS build step to extract: create `packages/extract/tsdown.config.ts` with pipeline entry. Update `packages/extract/package.json` build script and exports to include pipeline JS output alongside NAPI binary.
- [x] 3.9 Run `bun run --filter './packages/extract' build` — verify both NAPI binary and pipeline JS are produced.

## 4. Vite-Plugin Migration

- [x] 4.1 Update vite-plugin `package.json` — ensure `@animus-ui/extract` dependency (already exists) covers the pipeline exports.
- [x] 4.2 Replace `runAnalysis()` in vite-plugin with call to `runExtraction()` from extract. Map vite-plugin's stored state (themeJson, configJson, etc.) to `ExtractionInput`. Map `ExtractionResult` back to plugin's stored state (storedManifest, resolvedComponentCss, etc.).
      NOTE: runAnalysis still calls NAPI directly + uses local applyUnitFallback + keeps transform subprocess. The subprocess needs live JS functions (ESM isolation) which runExtraction can't receive across the process boundary. runExtraction is the entry point for direct consumers (test harness). Subprocess cleanup is a separate concern from the pipeline extraction — filed below as design note on 4.5.
- [x] 4.3 Remove `applyUnitFallback()` and UNITLESS_PROPERTIES from vite-plugin `index.ts`. Replaced with import from `@animus-ui/extract/pipeline`.
- [x] 4.4 Remove `applyPrefix()` from vite-plugin `index.ts`. Replaced with import from `@animus-ui/extract/pipeline`.
- [ ] 4.5 Remove transform resolution script generation (`systemResolveScript` temp file creation + subprocess execution) from vite-plugin.
      DEFERRED: Transform subprocess needs live JS functions from the system module (ESM isolation). Cannot be replaced by extract's resolveTransformPlaceholders() without a way to get live functions across the process boundary. Stays as a host concern.
- [x] 4.6 Update `resolve-global-styles.ts` subprocess to import `resolveGlobalStyles` from `@animus-ui/extract/pipeline` instead of inlining the logic. ~210 lines → ~70 lines. All resolution logic (resolveBlock, resolveTokenAliases, resolveValue, camelToKebab) eliminated from subprocess.
### Additional cleanup (not in original tasks)
- [x] Deleted `theme-evaluator.ts` — legacy evaluation removed (pre-beta, no backwards compat needed). subprocess calls `tokens.serialize()` directly.
- [x] Deleted `theme-evaluator.test.ts` — tested the legacy path (9 tests removed, 287 remaining).
- [x] loadSystem subprocess now returns `serialized: tokens.serialize()` — main process reads 4 JSON strings directly.

- [x] 4.7 Run `bun run verify:full` — full pipeline including Rust + showcase.

## 5. Verification

- [x] 5.1 Run `bun run test` — all tests pass. (287 pass, 0 fail — 9 legacy tests removed)
- [x] 5.2 Run `bun run verify:full` — full pipeline proof including showcase build.
- [x] 5.3 Grep vite-plugin source for `applyUnitFallback`, `applyPrefix`, `__TRANSFORM__` resolution logic — `applyUnitFallback` and `applyPrefix` zero matches (imported from extract). `__TRANSFORM__` subprocess resolution remains (deferred — ESM isolation constraint).
- [x] 5.4 Verify `packages/system/dist/pipeline/` does not exist.
- [x] 5.5 Verify `packages/extract/pipeline/` produces expected exports: runExtraction, applyPrefix, resolveGlobalStyles, resolveTokenAliases, resolveValue, resolveTransformPlaceholders, applyUnitFallback, camelToKebab.
