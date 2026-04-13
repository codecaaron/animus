## 0. Test Infrastructure Reliability

- [ ] 0.1 Pin bun version in `.github/workflows/ci.yaml` — add `bun-version: "1.3.11"` (or current known-good) to all 4 `oven-sh/setup-bun@v2` steps
- [ ] 0.2 Document NAPI loading contract in `packages/_integration/CLAUDE.md`: all tests MUST use `require('../../extract/index.js')` (direct path), never `require('@animus-ui/extract')` (package resolution). Reference the bun 1.3.12 incident.
- [ ] 0.3 Add CI binary verification step that tests NAPI resolution from the `_integration` test file context (not repo root) — verify `analyzeProject` is a function after require
- [ ] 0.4 Add biome lint rule or grep CI check that flags `require('@animus-ui/extract')` in `_integration` test files as a violation of the loading contract

## 1. Workspace Topology & Shared Assertion Utilities

- [ ] 1.1 Create `e2e/` top-level directory and `e2e/helpers/` subdirectory
- [ ] 1.2 Create `e2e/helpers/assert-css.ts` with structural assertion utilities: `assertLayerOrder()` (position-based), `assertNoPlaceholders()`, `assertClassNameFormat()`, `assertNoUnresolvedTokens()`, `assertNoEmotionImports()`
- [ ] 1.3 Create `e2e/helpers/find-build-assets.ts` with utilities to locate CSS and JS files in `dist/` or `.next/` output directories
- [ ] 1.4 Unit test the assertion utilities — verify `assertLayerOrder` fails on misordered CSS, passes on correct CSS

## 2. Vite Test App Fixture

- [ ] 2.1 Create `e2e/vite-app/package.json` (`@animus-ui/vite-test-app`, private, deps: system, test-ds, vite-plugin, react, react-dom, @vitejs/plugin-react, vite)
- [ ] 2.2 Create `e2e/vite-app/vite.config.ts` with `animusExtract({ system: './src/ds.ts' })` and `react()` plugin
- [ ] 2.3 Create `e2e/vite-app/tsconfig.json` extending root tsconfig
- [ ] 2.4 Create `e2e/vite-app/index.html` entry point
- [ ] 2.5 Create `e2e/vite-app/src/ds.ts` — minimal system definition using `@animus-ui/system` (createTheme + createSystem + withProperties + build)
- [ ] 2.6 Create component fixtures in `e2e/vite-app/src/components/`: Button (variants + states), Box (system props), Card (base styles), Stack (extension chain parent), StackItem (extension chain child via .extend()), Family (compose() with Root + Child + shared variant), barrel index.ts
- [ ] 2.7 Create `e2e/vite-app/src/App.tsx` rendering all components with representative prop usage
- [ ] 2.8 Add `"e2e/vite-app"` to root `package.json` workspaces list
- [ ] 2.9 Run `bun install` to link the new workspace package
- [ ] 2.10 Verify `bun run --filter '@animus-ui/vite-test-app' build` succeeds

## 3. Vite Test App Post-Build Assertions

- [ ] 3.1 Create `e2e/vite-app/scripts/assert-build.ts` using shared assertion utilities: find CSS in dist/, run `assertLayerOrder()`, `assertNoPlaceholders()`, `assertClassNameFormat()`, assert `:root` block exists, `assertNoEmotionImports()` on JS files
- [ ] 3.2 Add `"test:assert"` script to `e2e/vite-app/package.json` running `bun run scripts/assert-build.ts`
- [ ] 3.3 Add `"test:vite-app"` script to root `package.json`: `bun run --filter '@animus-ui/vite-test-app' build && bun run --filter '@animus-ui/vite-test-app' test:assert`
- [ ] 3.4 Add `test:vite-app` to `verify:full` pipeline in root `package.json`
- [ ] 3.5 Run `bun run test:vite-app` and verify all assertions pass

## 4. Upgrade Existing Post-Build Assertions

- [ ] 4.1 Create `scripts/assert-showcase-build.ts` replacing `scripts/assert-showcase.sh` — import shared utilities from `e2e/helpers/assert-css.ts`, apply position-aware layer order validation, keep all existing checks
- [ ] 4.2 Update root `package.json` `test:showcase` to run TypeScript assertion script instead of shell script
- [ ] 4.3 Create `packages/next-test-app/scripts/assert-build.ts` replacing `assert-next-build.sh` — import shared utilities, apply position-aware layer order validation, keep router-specific checks
- [ ] 4.4 Update root `package.json` `test:next` to run TypeScript assertion script instead of shell script
- [ ] 4.5 Run `bun run test:showcase` and `bun run test:next` to verify upgraded assertions pass
- [ ] 4.6 Delete old shell scripts (`scripts/assert-showcase.sh`, `packages/next-test-app/scripts/assert-next-build.sh`)

## 5. Plugin Self-Verification

- [ ] 5.1 Add `verify?: boolean` to `AnimusExtractOptions` type in vite-plugin
- [ ] 5.2 Implement verification checks in `buildStart` after analysis: component CSS non-empty, layer ordering correct, `:root` block present, no `__TRANSFORM__` placeholders
- [ ] 5.3 Wire verification failures to existing `strict` option: throw in strict mode, warn otherwise
- [ ] 5.4 Prefix all verification output with `[animus:verify]`
- [ ] 5.5 Add `verify: true` to `e2e/vite-app/vite.config.ts` to exercise during builds
- [ ] 5.6 Rebuild vite-plugin (`bun run --filter '@animus-ui/vite-plugin' build:ts`) and verify `bun run test:vite-app` still passes

## 6. Manifest Completeness Assertions

- [ ] 6.1 Create `packages/_integration/__tests__/manifest-shape.test.ts` — import NAPI functions from `run-pipeline.ts` (which uses direct path), NOT via `require('@animus-ui/extract')`
- [ ] 6.2 Implement component descriptor completeness assertions (all required fields non-empty)
- [ ] 6.3 Implement files-to-components consistency assertions (all component_ids in files exist in components)
- [ ] 6.4 Implement provenance reciprocity assertions (reverse_provenance ↔ extends_from)
- [ ] 6.5 Implement fragment consistency assertions (fragments keys ⊆ components keys, extracted components have non-empty fragments)
- [ ] 6.6 Implement dynamic props boundary test: fully static component → zero dynamic_props; mixed component → correct split with CSS variable slot rules
- [ ] 6.7 Implement system_prop_map validation: used props present, class names prefixed with `anm-`
- [ ] 6.8 Run `bun test packages/_integration` and verify all new tests pass

## 7. Investigation: storedSheets Compounds Gap

- [ ] 7.1 Inspect `CssSheets` struct in `css_generator.rs` — verify whether `compounds` field exists or is folded into another layer
- [ ] 7.2 Inspect vite-plugin's `storedSheets` usage — trace how dev-mode split CSS is assembled and whether compound CSS is included
- [ ] 7.3 If gap confirmed: file as separate openspec issue. If by design: document in extract/CLAUDE.md

## 8. Verification & Cleanup

- [ ] 8.1 Run `bun run verify` — all existing tests pass
- [ ] 8.2 Run `bun run verify:full` — includes new `test:vite-app`
- [ ] 8.3 Run `bun run test:next` — upgraded assertions pass
- [ ] 8.4 Run `bun run check` — biome clean on all new files
- [ ] 8.5 Update `packages/vite-plugin/CLAUDE.md` with `verify` option documentation
- [ ] 8.6 Update root `CLAUDE.md` verification commands table if needed
