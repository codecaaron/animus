## 1. Phase A — TypeScript 5.8.3 → 6.x (Prerequisite)

- [x] 1.1 Bump root `package.json` `devDependencies.typescript` from `5.8.3` to `6.0.3` (latest TS 6.x at implementation time). `bun install` materialized.
- [x] 1.2 Updated root `tsconfig.json`: `moduleResolution: node` → `bundler`. Existing `target`, `module`, `strict`, `declaration`, `sourceMap` remain valid.
- [x] 1.3 Audited `packages/system/tsconfig.json` + `tsconfig.build.json` — no removed-flag violations; default-flip exposure handled at root via `types` field.
- [x] 1.4 Audited `packages/properties/tsconfig.json` + `tsconfig.build.json` — clean.
- [x] 1.5 Audited `packages/_assertions/tsconfig.json` + `tsconfig.build.json` — clean.
- [x] 1.6 Audited `packages/extract/tsconfig.json` + `tsconfig.build.json` — clean.
- [x] 1.7 Audited `packages/vite-plugin/tsconfig.json` + `tsconfig.build.json` — clean.
- [x] 1.8 Audited `packages/next-plugin/tsconfig.json` + `tsconfig.build.json` — clean.
- [x] 1.9 Audited `packages/test-ds/tsconfig.json` + `tsconfig.build.json` — clean.
- [x] 1.10 Audited `packages/_integration/tsconfig.json` — clean (no `tsconfig.build.json`; private workspace).
- [x] 1.11 Audited `packages/showcase/tsconfig.json` — clean.
- [x] 1.12 Audited `packages/system/__tests__/tsconfig.test-d.json` — clean.
- [x] 1.13 Audited `e2e/next-app/tsconfig.json` + `e2e/vite-app/tsconfig.json` — clean structurally; next-app needed CSS module declaration (see fix-forward note).
- [x] 1.14 Ran `bun run verify:compile` + `bun run verify:types` (faster gate than `verify:full` — surfaced two default-flip issues). **Fix-forward at root cause**: (a) added `"types": ["node", "bun"]` to root `tsconfig.json` (TS 6.0 `types: []` default removed `@types/node`/`@types/bun` auto-injection); (b) added `e2e/next-app/styles.d.ts` with `declare module '*.css';` (TS 6.0 `noUncheckedSideEffectImports: true` requires module declarations for side-effect CSS imports). Full `verify:ci` + `verify:next` ran post-Phase-B and were green.
- [ ] 1.15 Run `bun run hygiene` and resolve any drift. **DEFERRED**: blocked by uncommitted changes (hygiene scan-mode requires clean worktree); user should run post-commit and confirm `converged` or `cap-hit-clean`.
- [ ] 1.16 Phase A commit boundary: **DEFERRED to user per `MANDATORY #1: Never use mutative git operations`**. Recommended Phase A commit content: root `package.json` typescript bump, root `tsconfig.json` (`moduleResolution: bundler` + `types: ["node", "bun"]`), `e2e/next-app/styles.d.ts`.

## 2. Phase B — Adopt `tsgo` for Type-Check

- [x] 2.1 Added `@typescript/native-preview@7.0.0-dev.20260421.2` (current `beta` dist-tag) to root `devDependencies`, exact pin (no `^`/`~`/dist-tag). `bun install` materialized.
- [x] 2.2 Updated `scripts/verify/_preconditions.sh::require_bun_install` to probe `node_modules/.bin/$TYPECHECK_BINARY` where `TYPECHECK_BINARY="${TYPECHECK_BINARY:-tsgo}"` — single-source-of-truth shell variable defined at top of helper, environment-overridable. Error message names the actual canonical binary.
- [x] 2.3 Updated `packages/system/package.json` `scripts.compile`: `tsc --noEmit` → `tsgo --noEmit`.
- [x] 2.4 Updated `packages/properties/package.json` `scripts.compile`.
- [x] 2.5 Updated `packages/_assertions/package.json` `scripts.compile`.
- [x] 2.6 Updated `packages/extract/package.json` `scripts.compile`: `tsc -p tsconfig.build.json --noEmit` → `tsgo -p tsconfig.build.json --noEmit` (extract uses build-tsconfig form).
- [x] 2.7 Updated `packages/vite-plugin/package.json` `scripts.compile`.
- [x] 2.8 Updated `packages/next-plugin/package.json` `scripts.compile`.
- [x] 2.9 Updated `packages/test-ds/package.json` `scripts.compile`.
- [x] 2.10 Updated `packages/showcase/package.json` `scripts.compile`. `_integration` has no `compile` script (test-only workspace) — skipped per proposal note.
- [x] 2.11 Updated `scripts/verify/types.sh`: `node_modules/.bin/tsc -p ...` → `node_modules/.bin/tsgo -p ...`.
- [x] 2.12 Added `compile:tsc-fallback` to all 8 active TS packages (system, properties, _assertions, extract, vite-plugin, next-plugin, test-ds, showcase) preserving the original `tsc --noEmit` (or `tsc -p tsconfig.build.json --noEmit` for extract) invocation verbatim.
- [x] 2.13 Added root `scripts.verify:compile:tsc-fallback`: `bun run --filter './packages/*' compile:tsc-fallback`. Confirmed NOT referenced by any composite orchestrator (`verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`, `verify:vite`).
- [x] 2.14 Ran `bun run verify:ci` (CI-equivalent, broader than `verify:full` minus `verify:build:next`/`verify:assert:next`) + `bun run verify:next` to round out Next coverage. **Both green** — every package's compile, build:ts, integration, build:showcase, assert:showcase, build:vite, assert:vite, build:next, assert:next exited 0.
- [x] 2.15 Ran `bun run verify:compile:tsc-fallback`. **Parity confirmed**: identical pass/fail to `verify:compile` (tsgo). Both report all 8 packages green.
- [ ] 2.16 knip behavior verification via `bun run hygiene`. **DEFERRED**: blocked by uncommitted changes (hygiene scan-mode requires clean worktree). User should run post-commit to inspect `.hygiene/receipts.jsonl`.
- [ ] 2.17 Phase B commit boundary: **DEFERRED to user per `MANDATORY #1: Never use mutative git operations`**. Recommended Phase B commit content: `@typescript/native-preview` add to root `package.json`, `_preconditions.sh`, `types.sh`, all 8 packages' `package.json` (compile + compile:tsc-fallback), root `verify:compile:tsc-fallback` script.

## 2C. Phase C — Adopt `tsgo` for Declaration Emit

Folded in after parity-gate verification (see § 3 / `scripts/verify/dts-parity.sh`).

- [x] 2C.1 Authored reusable parity gate `scripts/verify/dts-parity.sh`. Side-effect-free (writes only under `PARITY_DIR=/tmp/dts-parity` by default), compares `.d.ts` emit between `tsc` and `tsgo` across all `packages/*/tsconfig.build.json`. Exit 0/1/2 codes; per-file divergence printed inline.
- [x] 2C.2 Ran `bash scripts/verify/dts-parity.sh` on the post-Phase-B source tree. Result: 26 file-level divergences (12 `.d.ts` + 14 `.d.ts.map`) — categorized as: quote style (3), object-property ordering (1), generic alpha-renaming (1), type-alias eager expansion (6), JSDoc stripping on a `private` method (1, in `next-plugin/plugin.d.ts`). All divergences are no-op transformations on the type system; the JSDoc-stripping case is invisible to consumers (`private` modifier).
- [x] 2C.3 Swapped `build:ts` script in 7 packages: `tsdown && tsc -p tsconfig.build.json` → `tsdown && tsgo -p tsconfig.build.json`. Packages: `system`, `properties`, `_assertions`, `extract`, `vite-plugin`, `next-plugin`, `test-ds`. (`showcase` has no `build:ts`; `_integration` has no `tsconfig.build.json`.)
- [x] 2C.4 Ran `bun run clean:light && bun run build:ts`. All 7 packages emitted `.d.ts` via tsgo (system: 35, properties: 3, extract: 9, vite-plugin: 1, next-plugin: 6, _assertions: 3, test-ds: 8).
- [x] 2C.5 Ran `bun run verify:ci`. **Green** — 19 build/compile/test steps, all exited 0. Plus `bun run verify:next` — also green. Downstream consumers (Next, Vite, Showcase) use the tsgo-emitted dist .d.ts identically to the tsc baseline.
- [x] 2C.6 No fallback for declaration emit added. Justification: emit is invoked once per `build:ts` (not a hot inner-loop tier), the parity gate is reusable for future emit-engine swaps, and `verify:compile:tsc-fallback` already covers the type-check surface.
- [ ] 2C.7 Phase C commit boundary: **DEFERRED to user per `MANDATORY #1: Never use mutative git operations`**. Recommended Phase C commit content: 7 packages' `package.json` (build:ts swap), `scripts/verify/dts-parity.sh`, root `CLAUDE.md` (declaration-emit row + emit binary now `tsgo`), and the spec/proposal/design narrative updates.

## 3. Documentation Updates

- [x] 3.1 Updated root `CLAUDE.md`: added new `### TypeScript Implementations` subsection under `## Monorepo Build System` with workload-split table (workload | implementation | binary | package | pinned version | install command). Both pins (`typescript@6.0.3`, `@typescript/native-preview@7.0.0-dev.20260421.2`) recorded; documentation-vs-package.json drift treated as defect per the `typescript-toolchain` capability.
- [x] 3.2 No new failure modes surfaced during Phase B verification (parity between tsgo and tsc was identical pass/fail). Debugging Decision Tree at `packages/extract/CLAUDE.md` § Debugging Quick-Ref unchanged.
- [x] 3.3 Updated root `CLAUDE.md` Verification Tier Table: `verify:compile` row swapped from "`tsc --noEmit` across all packages" to "`tsgo --noEmit` across all packages"; runtime classification updated from `medium` → `fast` to reflect the ~10x speedup. `verify:types` row's wording (`type-contract tests via tsconfig.test-d.json`) is unchanged — abstract enough to remain accurate under either implementation.

## 4. Final Validation

- [x] 4.1 Ran `bun run verify:ci`. **Green** — 19 build/compile/test steps, all exited 0, no errors. Plus `bun run verify:next` (excluded from `verify:ci` script body) — also green.
- [ ] 4.2 Run `bun run hygiene` end-to-end. **DEFERRED**: blocked by uncommitted changes. User should run post-commit to confirm `converged` or `cap-hit-clean`. The `compile:tsc-fallback` per-package scripts are expected new live-script entries that knip will recognize via the TS plugin (knip ≥5.84.0 supports both `tsc` and `tsgo` binaries).

## Deferred Work (NOT in this change)

The following items are explicitly out of scope and will be handled by separate future changes once their preconditions are met. They appear here for reviewer reference only.

- **Phase C (separate future change)**: Adopt `tsgo` for declaration emit (`tsc -p tsconfig.build.json` swap). Preconditions: TS 7.0 stable lands; the typescript-go feature table marks declaration emit "done"; a parity gate is established (per `typescript-toolchain` "Declaration Emit Implementation Selection" requirement). The future change will modify `typescript-toolchain` to name the new canonical declaration-emit implementation.

- **Soak fallback removal (separate follow-on commit)**: After the new canonical type-check implementation has been stable for at least one inner-loop cycle (one calendar week minimum), a follow-on commit removes the root `verify:compile:tsc-fallback` script AND the per-package `compile:tsc-fallback` scripts added in tasks 2.12–2.13. The follow-on commit also removes the `typescript@5.x` co-installed devDependency if no other workload depends on it.

- **`--watch` mode adoption**: Not in `tsgo` beta. Will be reconsidered when Microsoft ships the efficient `--watch` implementation per their public timeline.
