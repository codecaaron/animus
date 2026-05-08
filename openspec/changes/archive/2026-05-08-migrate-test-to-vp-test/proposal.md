## Why

The animus monorepo's vp-arc decomposition (per `orchestration-architecture` spec lines 150-156) names five cutover slices. Four have shipped: linter/formatter (`migrate-lint-to-vp-check`), task-graph orchestrator (`migrate-orchestrator-to-vp-run`), hygiene cascade (`migrate-hygiene-cascade-to-oxlint`), and biome-residue cleanup (`finalize-biome-to-oxlint-residue`). This proposal closes the **test runner** slice, rebinding from `bun test` to `vp test` (vitest under the hood) per the named follow-on policy in `bun-test/spec.md:69`. The rebind preserves every test-runner semantic (snapshot inlining, parameterization, DOM environment, discovery patterns) while consolidating test invocation under the single orchestrator surface that already owns lint/format/typecheck/build.

## What Changes

**Test runner binding rebind** (preserves all semantics):

- Replace `from 'bun:test'` imports with `from 'vitest'` across 25 test files (22 in `packages/`, 3 in `scripts/hygiene/`).
- Translate `spyOn` → `vi.spyOn` at one site (`packages/system/__tests__/theme.test.ts:353`); all other API names (`describe`, `it`, `test`, `expect`, `beforeAll`, `beforeEach`) are 1:1 between `bun:test` and `vitest`.
- Add `test:` block to `vite.config.ts` (vitest reads vite.config natively): `{ environment: 'happy-dom' }`.
- Add new `test` task to `vite.config.ts` `run.tasks`: `{ command: 'bunx vp test run', cache: false }`.
- Modify `verify:unit:ts` task: replace `bash scripts/verify/unit-ts.sh` with direct `bunx vp test run <unit-paths>` invocation.
- Delete `scripts/verify/unit-ts.sh` (vp test is the orchestrator-native equivalent the orchestration-architecture spec invariant anticipates).
- Add `vitest` and `happy-dom` as root devDependencies (TypeScript types resolution + decoupling from vp-test internal version).
- Update `package.json` test scripts at root and `packages/_integration`.

**Spec updates**:

- `bun-test`: MODIFIED on Binding requirement + invocation scenarios (rebind from `bun test` to `vp test`).
- `orchestration-architecture`: NO MODIFY — the rebind succeeds under preservation invariants (loud-fail, .tool-versions, Change-Type Map, dist-staleness, atomic-tier-isolation, Rust-pipeline-exclusion, dependency-derived-build-ordering) without spec-text change.

No breaking changes to test code semantics, snapshot behavior, parameterization, DOM env, or test discovery. Risk is narrowly scoped to the runner-binding swap.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bun-test`: rebind invocation surface from `bun test` to `vp test`; preserve all semantic requirements (snapshot inlining, parameterization, DOM environment, file compatibility); update binding-to-orchestration-architecture requirement to reflect new current-binding string.

## Impact

**Affected code**:

- 25 test files (import migration)
- `vite.config.ts` (test config block + run.tasks edits)
- `scripts/verify/unit-ts.sh` (deletion)
- Two `package.json` files (root + `packages/_integration` test script)
- `bun-test/spec.md` (MODIFIED requirement blocks)

**Affected dependencies**:

- ADD: `vitest`, `happy-dom` as root devDependencies (vp test bundles vitest internally; explicit dev dep is for types + version control, not for runtime resolution).
- No removals.

**Affected systems**:

- Local test invocation: `bun test` → `vp test run` (or `bun run test` → `vp run test`).
- CI: no changes (already dispatches via `bunx vp run verify:unit:ts`).
- Pre-commit hooks: none currently invoke tests directly.

**Verification tier set per Change-Type Map**: `verify:compile && verify:types && verify:unit:ts && verify:integration && verify:canary` plus full `verify`. Baseline pass count must hold (~624 tests / 30 files per session 95 memory).

## Risk Acceptance

This proposal is gated by `orchestration-architecture/spec.md` Requirement "Migration Trigger Criteria" Scenario "Pre-GA cutover requires risk-acceptance" because vite-plus 0.1.20 has not reached GA per the VoidZero release channel.

**Specific alpha-status exposure for this cutover slice**:

- vp test at vite-plus 0.1.20 ships as `@voidzero-dev/vite-plus-test@0.1.20` with bundled `@vitest/runner@4.1.5` and related vitest packages.
- The vp test command surface (`run`, `watch`, `dev`, `bench`, `list`) is functionally complete but pre-GA; behavioral surprises in edge-case test execution patterns are theoretically possible.
- Test discovery, environment selection, snapshot inlining, and parameterization under vp test have not been formally certified by VoidZero as stable.

**Mitigations**:

1. **Bundled vitest version pin**: vitest 4.1.5 is locked via `@voidzero-dev/vite-plus-test`'s internal dependency graph; explicit root `vitest` dep tracks the same version for type alignment.
2. **Smoke verification on every test execution**: every developer/CI invocation of `vp test run` is a real-world test of the binding; baseline maintenance (~624/0/30 files) catches regressions empirically at commit time.
3. **Reversibility**: this proposal's edits are localized and revertible via a single revert-commit of the merged change; no schema or data migrations introduce one-way dependencies.
4. **Parallel test-pass count maintenance as regression evidence**: tasks.md §9 gates archive on baseline pass count match (no new tests added by this proposal; no tests skipped); divergence between baseline and post-rebind counts indicates regression.

**Maintainer sign-off**: codecaaron (repository maintainer) authorized this slice via session-explicit directive ("Proceed with your recommendations — I trust you continue until legitimate"), delegating execution authority across all remaining vp-arc slices and accepting alpha-status risk as a known-and-acceptable tradeoff for orchestrator unification under the single-orchestrator-surface invariant.

This signed risk acceptance satisfies pre-GA Criterion B per `orchestration-architecture/spec.md` Requirement "Migration Trigger Criteria".
