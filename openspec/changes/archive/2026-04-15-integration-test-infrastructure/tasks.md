## 0. Test Infrastructure Reliability

- [x] 0.1 Verify `.tool-versions` pins bun to a specific version (currently `bun 1.3.11`) AND `.github/workflows/ci.yaml` references it via `bun-version-file: .tool-versions` in all 4 `oven-sh/setup-bun@v2` steps (already in place — confirm and document the contract)
- [x] 0.2 Document NAPI loading contract in `packages/_integration/CLAUDE.md`: all tests MUST use `require('../../extract/index.js')` (direct path), never `require('@animus-ui/extract')` (package resolution). Reference the bun 1.3.12 incident.
- [x] 0.3 Add CI binary verification step that tests NAPI resolution from the `_integration` test file context (not repo root) — verify `analyzeProject` is a function after require
- [x] 0.4 Add biome lint rule or grep CI check that flags `require('@animus-ui/extract')` in `_integration` test files as a violation of the loading contract

## 1. Shared Assertion Utilities (in `packages/_assertions`)

> Rebased per `e2e-workspace-topology` (2026-04-14): shared assertion utilities live in `packages/_assertions/` (the post-topology home for shared assertions importable by both `packages/*` post-build scripts and `e2e/*` fixture apps), not `e2e/helpers/`. The `_assertions` scaffold was created in advance specifically for this change to populate.

- [x] 1.1 Populate `packages/_assertions/src/assert-css.ts` with structural assertion utilities: `assertLayerOrder()` (position-based), `assertNoPlaceholders()`, `assertClassNameFormat()`, `assertNoUnresolvedTokens()`, `assertNoEmotionImports()`
- [x] 1.2 Populate `packages/_assertions/src/find-build-assets.ts` with utilities to locate CSS and JS files in `dist/` or `.next/` output directories
- [x] 1.3 Update `packages/_assertions/src/index.ts` to export the new utilities (replacing the scaffold-only `export {};`)
- [x] 1.4 Add unit tests at `packages/_assertions/__tests__/assert-css.test.ts` — verify `assertLayerOrder` fails on misordered CSS, passes on correct CSS; verify other utilities behave as specified (also added `__tests__` path to `scripts/verify/unit-ts.sh`)
- [x] 1.5 Update `packages/_assertions/CLAUDE.md` removing the scaffold-only notice; document the utility surface and consumers
- [x] 1.6 Build the package (`bun run --filter '@animus-ui/assertions' build:ts`) and confirm `dist/index.js` + `dist/index.d.ts` are emitted

## 2. Vite Test App Fixture (`e2e/vite-app`)

> Rebased per `e2e-workspace-convention` Naming Convention (2026-04-14): package name is `@animus-ui/vite-app` (mirrors the `@animus-ui/next-app` rename), NOT `@animus-ui/vite-test-app` — the convention forbids `e2e`/`test`/`fixture` as prefix/suffix.

- [x] 2.1 Create `e2e/vite-app/package.json` (`@animus-ui/vite-app`, private, `type: module`, deps: `@animus-ui/system`, `@animus-ui/test-ds`, `@animus-ui/vite-plugin`, `react`, `react-dom`, `@vitejs/plugin-react`, `vite`; devDeps include `@animus-ui/assertions` for the assert script)
- [x] 2.2 Create `e2e/vite-app/vite.config.ts` with `animusExtract({ system: './src/ds.ts' })` and `react()` plugin
- [x] 2.3 Create `e2e/vite-app/tsconfig.json` extending root tsconfig
- [x] 2.4 Create `e2e/vite-app/index.html` entry point
- [x] 2.5 Create `e2e/vite-app/src/ds.ts` — minimal system definition using `@animus-ui/system` (`createTheme` + `createSystem` + `addGroup` + `.includes([testDs])` + `.build()`); declare-module augment global Theme with the local tokens
- [x] 2.6 Create component fixtures in `e2e/vite-app/src/components/`: Button (variants + states), Box (system props), Card (base styles), Stack (extension chain parent), StackItem (extension chain child via .extend()), Family (compose() with Root + Child + shared variant), barrel index.ts
- [x] 2.7 Create `e2e/vite-app/src/App.tsx` and `src/main.tsx` rendering all components with representative prop usage
- [x] 2.8 Add `"e2e/vite-app"` to root `package.json` workspaces list
- [x] 2.9 Run `bun install` to link the new workspace package
- [x] 2.10 Verify `bun run --filter '@animus-ui/vite-app' build` succeeds

## 3. Vite Test App Verify Tiers (`verify:build:vite` + `verify:assert:vite`)

> Rebased per `verification-tier-policy` (2026-04-13): atomic-tier architecture (`verify:build:X` + `verify:assert:X` + composite `verify:X`) replaces the `test:X` combined commands the original tasks assumed. Mirrors the existing `verify:build:next`/`verify:assert:next` pair.

- [x] 3.1 Create `e2e/vite-app/scripts/assert-build.ts` using shared `@animus-ui/assertions` utilities: find CSS in `dist/`, run `assertLayerOrder()` (with a relaxed list pending `fix-lightningcss-cascade`), `assertNoPlaceholders()`, `assertClassNameFormat()`, assert `:root` block exists, `assertNoEmotionImports()` on JS files
- [x] 3.2 Create `scripts/verify/build-vite.sh` mirroring `scripts/verify/build-next.sh`: source `_preconditions.sh`, `require_fresh_napi`, `require_fresh_package_dist extract|system|vite-plugin|properties`, `exec bun run --filter '@animus-ui/vite-app' build`
- [x] 3.3 Create `scripts/verify/assert-vite.sh` mirroring `scripts/verify/assert-next.sh`: source `_preconditions.sh`, `require_dir e2e/vite-app/dist 'bun run verify:build:vite'`, `require_fresh_package_dist _assertions`, `exec bun run e2e/vite-app/scripts/assert-build.ts`
- [x] 3.4 Add `verify:build:vite`, `verify:assert:vite`, and `verify:vite` (composite: `verify:build:vite && verify:assert:vite`) scripts to root `package.json`
- [x] 3.5 Add `verify:build:vite && verify:assert:vite` to the `verify:full` chain in root `package.json` (and `verify:ci`)
- [x] 3.6 Run `bun run verify:vite` and verify all assertions pass

## 4. Upgrade Existing Post-Build Assertions to TypeScript

> Rebased per `e2e-workspace-topology` (2026-04-14): Next assertion script lives at `e2e/next-app/scripts/assert-next-build.sh` (not `packages/next-test-app/scripts/`). Notes: the existing shell script greps for `@layer base`/`@layer variants` while extracted CSS uses `@layer anm-base`/`@layer anm-variants` — the §11.8 gap from sessions 75/76. The TS rewrite using shared `assertLayerOrder()` resolves this naturally.

- [x] 4.1 Create `scripts/assert-showcase-build.ts` replacing `scripts/assert-showcase.sh` — import shared utilities from `@animus-ui/assertions`, apply position-aware layer order validation, keep all existing checks
- [x] 4.2 Update `scripts/verify/assert-showcase.sh` to `exec bun run scripts/assert-showcase-build.ts` (added `require_fresh_package_dist _assertions`)
- [x] 4.3 Create `e2e/next-app/scripts/assert-build.ts` replacing `assert-next-build.sh` — uses `layerBlock('anm-base')` / `layerBlock('anm-variants')` with the correct `anm-` prefix, keeps router-specific checks
- [x] 4.4 Update `scripts/verify/assert-next.sh` to `exec bun run e2e/next-app/scripts/assert-build.ts` (added `require_fresh_package_dist _assertions`)
- [x] 4.5 Run `bun run verify:assert:showcase` and `bun run verify:assert:next` — both green. **§11.8 layer-name gap resolved** (shell scripts grepped for `@layer base` / `@layer variants`; TS assertions use the correct `@layer anm-base` / `@layer anm-variants`)
- [x] 4.6 Delete old shell scripts (`scripts/assert-showcase.sh`, `e2e/next-app/scripts/assert-next-build.sh`)

## 5. Plugin Self-Verification

- [x] 5.1 Add `verify?: boolean` to `AnimusExtractOptions` type in `packages/vite-plugin/src/`
- [x] 5.2 Implement verification checks in `buildStart` after analysis: component CSS non-empty, layer ordering correct (`@layer anm-base` precedes `@layer anm-variants`), `:root` block present, no `__TRANSFORM__` placeholders
- [x] 5.3 Wire verification failures to existing `strict` option: throw in strict mode, warn otherwise
- [x] 5.4 Prefix all verification output with `[animus:verify]`
- [x] 5.5 Add `verify: true` to `e2e/vite-app/vite.config.ts` to exercise during builds
- [x] 5.6 Rebuild vite-plugin (`bun run --filter '@animus-ui/vite-plugin' build:ts`) and verify `bun run verify:vite` still passes

## 6. Manifest Completeness Assertions

- [x] 6.1 Create `packages/_integration/__tests__/manifest-shape.test.ts` — uses `runPipeline()` from `run-pipeline.ts` (which uses direct-path NAPI), no `require('@animus-ui/extract')`
- [x] 6.2 Implement component descriptor completeness assertions (all required fields non-empty; class_name starts with `animus-`)
- [x] 6.3 Implement files-to-components consistency assertions (all component_ids in files exist in components + descriptor.file matches)
- [x] 6.4 Implement provenance reciprocity assertions (reverse_provenance ↔ extends_from — both directions)
- [x] 6.5 Implement fragment consistency assertions (fragments keys ⊆ components keys, extracted components have non-empty fragments)
- [x] 6.6 Implement dynamic props boundary test: fully static button.tsx fixture → zero dynamic_props; dynamic prop entries carry `var_name` / `slot_class` / `property` metadata
- [x] 6.7 Implement system_prop_map validation: used props present, class names prefixed with `animus-u-` (the actual utility class prefix — the spec's `anm-` was stale, delta specs corrected inline)
- [x] 6.8 Run `bun run verify:integration` — 98/98 pass

## 7. Investigation: storedSheets Compounds Gap

- [x] 7.1 Inspect `CssSheets` struct in `css_generator.rs` — `compounds: String` field present (line 80). Declaration header includes compounds in the `@layer global, base, variants, compounds, states, system, custom;` sequence
- [x] 7.2 Inspect vite-plugin's `storedSheets` usage — TS type at line 284 was MISSING the `compounds` field. Runtime impact was minor (compound CSS is still delivered via `resolvedComponentCss`), but the per-layer split representation was incomplete vs the Rust struct
- [x] 7.3 Gap resolved INLINE during investigation: added `compounds: string` to the `storedSheets` type in `packages/vite-plugin/src/index.ts`, added a comment cross-referencing `css_generator.rs` so the types stay in sync; no separate openspec issue needed

## 8. Verification & Documentation

- [x] 8.1 Run `bun run verify` — captured via the `verify:full` composite (below) which chains `verify` + integration + build + assert
- [x] 8.2 Run `bun run verify:full` — EXIT 0. All 12 atomic tiers green (lint, compile, types, unit:ts, unit:rust, canary, integration, build:next, build:showcase, build:vite, assert:next, assert:showcase, assert:vite)
- [x] 8.3 Confirm `bun run verify:assert:next` and `verify:assert:showcase` pass under the upgraded TS assertions — **§11.8 closed** (the shell-layer-name-gap resolved by `layerBlock('anm-base')` / `layerBlock('anm-variants')` in the TS rewrite)
- [x] 8.4 Run `bun run check` — biome clean (added a `scripts/**` override for `noConsole` since the new TS assertion scripts are CLI entry points, matching the existing `vite-plugin/**` / `next-plugin/**` exemptions)
- [x] 8.5 Update `packages/vite-plugin/CLAUDE.md` with `verify` option documentation (new section covers strict-throws/warn behavior, `[animus:verify]` prefix, pairing with assertion scripts)
- [x] 8.6 Update root `CLAUDE.md`:
  - Added `verify:build:vite` and `verify:assert:vite` rows to Atomic Tiers table
  - Added `verify:vite` row to Composite Orchestrators table
  - Updated `verify:assert:next` / `verify:assert:showcase` precondition entries to include `fresh _assertions/dist/`
  - Added Change-Type Map rows for `e2e/vite-app/src/**` and `packages/_assertions/src/**`
  - Broadened `packages/vite-plugin/src/**` row to also include `verify:vite`
- [x] 8.7 Update `.claude/rules/TESTING.md`: frontmatter paths updated (added new TS assertion scripts, removed old shell path); Tiers list has accurate `e2e/next-app/.next/` path and new `verify:assert:vite` entry
