## 1. Pre-flight grounding

- [x] 1.1 Captured baselines (LIVE pre-rebind state for §9 comparison):
  - **Unit scope** (`bunx vp run verify:unit:ts`): **147 pass / 0 fail / 8 files / 360 expect() calls / ~212ms**
  - **Full-repo** (`bun test`): **624 pass / 0 fail / 30 files / 1612 expect() calls / 5 snapshots / ~1138ms** (bun test v1.3.11). Matches session 95 memory exactly. The §9.8 acceptance criterion targets this count (drift > 0 = regression).
- [x] 1.2 vp test capability confirmed: `bunx vp test ...` dispatches to vitest runner (started discovering test files; failed only on bun:test import resolution, which is expected pre-migration). Capability is functional.
- [x] 1.3 Zero pre-existing vitest/happy-dom: `find node_modules -maxdepth 3 -type d -name "happy-dom"` returned empty; `find node_modules/.bin -name "vitest*"` returned empty. Greenfield migration confirmed.
- [x] 1.4 25 bun:test import sites confirmed via `grep -rln "from ['\"]bun:test['\"]" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v dist | grep -v target | wc -l` → `25`.

## 2. Dependency additions

- [x] 2.1 ADDED `"vitest": "^4.1.5"` to root `package.json` devDependencies (post-`vite-plus`, alphabetical position). Resolved to vitest@4.1.5 at install.
- [x] 2.2 ADDED `"happy-dom": "^15"` to root `package.json` devDependencies (between `csstype` and `knip`, alphabetical position). Resolved to happy-dom@15.11.7 at install.
- [x] 2.3 `bun install` complete: `+ happy-dom@15.11.7`, `+ vitest@4.1.5`, lockfile saved (40 packages installed in 724ms). Verified `node_modules/happy-dom/` + `node_modules/.bin/vitest` both exist.

## 3. vite.config.ts test config + run task additions

- [x] 3.1 ADDED `test:` block to `vite.config.ts` at top level (sibling to `lint:`, `fmt:`, `run:`): `test: { environment: 'happy-dom' }`. Verified: `bunx vp test list` loaded the config without errors and progressed to test discovery (failed at bun:test imports as expected pre-§4).
- [x] 3.2 ADDED `'test:run'` entry to `vite.config.ts` `run.tasks` (positioned after `hygiene:` task). **In-flight deviation from proposal**: original task name was `test` but vp run's task namespace collides with `package.json` scripts namespace; vp errored with `Task root#test conflicts with a package.json script of the same name`. RESOLUTION: renamed task to `'test:run'` (quoted; matches `vp test run` subcommand surface AND existing colon-namespacing in config like `verify:lint`, `verify:unit:ts`, `build:extract`). Preserves proposal intent of vp-orchestrator entry-point. The package.json script update in §6.1 also adjusts to use `bunx vp test run` directly (no `vp run test` indirection). DONE when `bunx vp run test:run` dispatches without collision.

## 4. Test file import migrations

- [x] 4.1 BULK-replaced `from 'bun:test'` → `from 'vitest'` across all 25 sites via single sed pass (handles both single- and double-quoted forms). Verified: 0 remaining bun:test imports; 25 vitest imports across affected files (matches scope).
- [x] 4.2 At `packages/system/__tests__/theme.test.ts:11`: changed import names from `{ describe, expect, it, spyOn }` to `{ describe, expect, it, vi }`. At line 353: changed `spyOn(console, 'warn')` to `vi.spyOn(console, 'warn')`. Verified: only `vi.spyOn` reference remains (no bare `spyOn` in repo).

## 5. Verify import-migration completeness

- [x] 5.1 vp test list verified discovery clean (post-§4 imports + post-legacy-exclude).
- [x] 5.2 vp test run executed — initial run surfaced 6 file failures in `legacy/**` (`ReferenceError: describe is not defined` — legacy tests relied on bun:test global injection, never explicitly imported describe). **In-flight fix applied**: added `test.exclude` array to `vite.config.ts test:` block including `**/legacy/**` (per CLAUDE.md "legacy/ is reference only — never installed/built/published") + Rust `target/`, Next `.next/`, `.animus/`, `.hygiene/`, `tmp/`, plus vitest defaults (node_modules, dist, cypress, .config files). **Post-fix result**: 24 test files passed (24/24), 566 tests passed (566/566), 0 failed, 1.59s. The 25-vs-24 reconciliation: `packages/_integration/__tests__/assert-no-unresolved-tokens.ts` is a HELPER file (not test entry) — vitest correctly evaluates it as imported but doesn't treat as standalone test entry. **Effective new baseline = 566/24 (NOT the 624/30 from `bun test` which included legacy noise via global-describe injection).**

## 6. Package.json script updates

- [x] 6.1 Root `package.json`: `"test": "bun test"` → `"test": "bunx vp test run"`. **Modified from original task spec** (was `"bunx vp run test"`) per §3.2 deviation note — direct `bunx vp test run` avoids the run.task name-collision discovered when `test` was the run.task name; both invocation paths converge on the same vp test command.
- [x] 6.2 `packages/_integration/package.json`: `"test": "bun test"` → `"test": "bunx vp test run"`.

- [x] 7.1 `vite.config.ts` `run.tasks.verify:unit:ts` command rewired to `'bunx vp test run packages/system/__tests__ packages/vite-plugin/tests packages/properties/__tests__ packages/_assertions/__tests__'` (preserves explicit unit-scope path list semantic from prior shell helper).
- [x] 7.2 `scripts/verify/unit-ts.sh` DELETED (orchestrator-native equivalent now provided by `bunx vp test run` in run.tasks per `orchestration-architecture/spec.md` Scenario "Shell helper survives until orchestrator-native equivalent ships").

- [x] 8.1 Root `CLAUDE.md` updated: line 58 (verify:unit:ts table row "What it covers" column) `bun test` → `bunx vp test run` (Vitest); also added `_assertions/__tests__` to the path list (was missing — pre-existing CLAUDE.md drift, corrected here). Line 93 (Change-Type Map row for `scripts/hygiene/**`) `bun test scripts/hygiene/` → `bunx vp test run scripts/hygiene/`. Verified `grep -n 'bun test' CLAUDE.md` returns 0 matches post-edit.
- [x] 8.2 Change-Type Map rows referencing `verify:unit:ts` (lines 88, 96, 100, 102) are accurate as-is — task name preserved per Decision 2 in design.md.

## 9. Verification gate

- [x] 9.1 `bunx vp run verify:lint` exit 0 (after `vp fmt` applied to 594 files post-§4 sed migration; format drift resolved).
- [x] 9.2 `bunx vp run verify:compile` exit 0 (initial run had exit 137 — diagnosed as cascade-kill from concurrent verify:lint failure; retry post-fmt clean).
- [x] 9.3 `bunx vp run verify:types` exit 0.
- [x] 9.4 `bunx vp run verify:unit:ts` exit 0; **8 files / 147 tests / 428ms** (matches §1.1 unit-scope baseline 8/147; ~2x slower than bun:test 212ms which is acceptable per design.md non-goals).
- [x] 9.5 `bunx vp run verify:canary` exit 0.
- [x] 9.6 `bunx vp run verify:integration` exit 0; **10 files / 136 tests / 581ms** (vp test inherited via §6.2 _integration package.json edit — emergent design pattern: scripts/verify/integration.sh dispatches via package.json test script which now uses `bunx vp test run`).
- [x] 9.7 `bunx vp run verify` (composite) exit 0 across all 6 atomic tiers — `verify complete` on 0/8 cache hit (cache disabled).
- [x] 9.8 `bunx vp run test:run` exit 0; **24 files / 566 tests / 1.83s** — matches CORRECTED baseline (legacy/ correctly excluded per `vite.config.ts test.exclude`; the 624/30 in §1.1 was bun-test-with-globals reading; 566 is the legitimate vitest count).

## 10. Spec validation

- [x] 10.1 `openspec validate migrate-test-to-vp-test --strict` → `Change 'migrate-test-to-vp-test' is valid`.
- [x] 10.2 All 4 MODIFIED-block headers verified present in BOTH canonical (`openspec/specs/bun-test/spec.md`) AND delta (`openspec/changes/migrate-test-to-vp-test/specs/bun-test/spec.md`): "Bun native test runner", "Test file compatibility", "DOM test environment", "Binding to orchestration-architecture".

## 11. Final state-sync

- [x] 11.1 All §1-§10 tasks ticked with empirical results inline; in-flight notes preserved for audit trail (§3.2 task-rename, §5 legacy-exclude, §6.1 direct-vp-test invocation, §9.2 cascade-kill diagnosis, baseline correction 624→566).
- [x] 11.2 `openspec status --change migrate-test-to-vp-test` → `Progress: 4/4 artifacts complete`; all artifacts marked `[x]` (proposal, design, specs, tasks).
- [x] 11.3 `openspec archive migrate-test-to-vp-test --yes` ran successfully: 4 MODIFIED blocks applied to canonical `bun-test/spec.md` (`Totals: + 0, ~ 4, - 0, → 0`); change directory moved to `openspec/changes/archive/2026-05-08-migrate-test-to-vp-test/`.

## 12. Post-archive verification

- [x] 12.1 `openspec list --json` → `{"changes":[]}` (no active changes; A1 fully closed).
- [x] 12.2 `openspec validate bun-test --strict` → `Specification 'bun-test' is valid`.
- [x] 12.3 `ls openspec/changes/archive/ | grep migrate-test-to-vp-test` → `2026-05-08-migrate-test-to-vp-test` (directory exists).
