## Context

The animus monorepo's vp-arc decomposition (per `orchestration-architecture/spec.md` lines 150-156) names five cutover slices. Four shipped before this proposal: `migrate-lint-to-vp-check`, `migrate-orchestrator-to-vp-run`, `migrate-hygiene-cascade-to-oxlint`, and `finalize-biome-to-oxlint-residue`. The test-runner slice closes the fourth-of-five major workflows under `vp` (lint/format, task graph, hygiene, **test**), leaving only library bundler and cleaning surface.

Current state at proposal time:

- 25 test files import from `bun:test` (22 in `packages/`, 3 in `scripts/hygiene/`)
- Test invocation chokepoint: `bunx vp run verify:unit:ts` → `bash scripts/verify/unit-ts.sh` → `bun test <paths>`
- `vp test` is a vitest-bundled command surface in `vite-plus@0.1.20` (`@voidzero-dev/vite-plus-test@0.1.20` ships `@vitest/runner@4.1.5` internally)
- No `vitest.config.ts`, no `happy-dom` in `node_modules`
- vite-plus 0.1.20 is alpha (pre-GA) — Risk Acceptance section in proposal.md gates the cutover

Constraints (from `orchestration-architecture/spec.md` and `bun-test/spec.md`):

- Loud-fail atomic-tier preconditions SHALL be preserved
- `.tool-versions` bun pin SHALL be preserved
- Change-Type Map authoritativeness SHALL be preserved
- Test semantics (snapshot inlining, parameterization, DOM availability, file compatibility) SHALL be preserved
- The Rust pipeline is excluded from the rebind (no impact on `cargo test`)

Stakeholders: codecaaron (sole repository maintainer; Risk Acceptance signed via session-explicit directive).

## Goals / Non-Goals

**Goals:**

- Rebind the test-runner invocation from `bun test` to `vp test` while preserving every test semantic
- Add a top-level `test` task to `vite.config.ts run.tasks` for developer convenience (`bun run test` proxies via `vp run test`)
- Migrate 25 test files from `bun:test` imports to `vitest` imports with minimal API translation (only `spyOn` → `vi.spyOn` at one site)
- Configure happy-dom as the DOM environment under vitest (preserving the spec's DOM-env preference)
- Remove `scripts/verify/unit-ts.sh` since vp test is the orchestrator-native equivalent the spec invariant anticipates
- Maintain pass-count baseline (~624 tests / 30 files per session 95) as regression evidence

**Non-Goals:**

- Changing test SEMANTICS (snapshot, parameterization, DOM env preference, discovery patterns) — preserved by spec invariants
- Re-introducing Jest, babel-jest, or jest-environment-jsdom — explicitly forbidden by `bun-test/spec.md` Requirement "No Jest configuration"
- Modifying the Rust test pipeline (`cargo test`) — explicitly out of scope per `orchestration-architecture/spec.md` Requirement "Rust Pipeline Excluded from Orchestrator Scope"
- Adding new tests, removing tests, or changing assertion logic — this proposal is a runner-rebind, not a test-suite refactor
- Renaming `verify:unit:ts` — Change-Type Map preservation invariant requires keeping the name; only the internal command changes

## Decisions

### Decision 1: Vitest config lives in `vite.config.ts test:` block, not a separate `vitest.config.ts`

**Rationale**: Vitest natively reads its config from `vite.config.ts` when present (no separate file needed). The vite-plus convention surfaced in session 96 (`finalize-biome-to-oxlint-residue` per `project_oxc_tooling_boundaries` memory) explicitly directs configuration to live IN `vite.config.ts` blocks (`lint:`, `fmt:`, `run:`, and now `test:`) rather than standalone files — the orchestrator wrapping pattern. Standalone files like `vitest.config.ts` would NOT be loaded by vp test and would silently no-op (the same anti-pattern as the failed `oxfmt.config.ts` placement in session 96).

**Alternatives considered**:

- Separate `vitest.config.ts` file: rejected (vp does not load it; produces inert config; violates the "config in one place" vite-plus convention)
- `package.json` `vitest` field: rejected (vitest supports it but inconsistent with the lint/fmt/run convention)

### Decision 2: `verify:unit:ts` task name preserved; only its `command` changes

**Rationale**: `orchestration-architecture/spec.md` Requirement "Change-Type Map Survives Orchestrator Swap" mandates that cutover follow-ons preserve the agent-facing instructability surface. Renaming `verify:unit:ts` would force Change-Type Map row-edits across multiple entries and break agent muscle memory. The internal command swap (`bash scripts/verify/unit-ts.sh` → `bunx vp test run <paths>`) is invisible to consumers of the Change-Type Map.

**Alternatives considered**:

- Rename to `verify:test`: rejected (breaks Change-Type Map; orphans agent invocation patterns)
- Rename to `test:unit`: rejected (loses the verification-tier prefix that the verification-tier-policy spec mandates)

### Decision 3: `scripts/verify/unit-ts.sh` is REMOVED (not preserved as a wrapper)

**Rationale**: `orchestration-architecture/spec.md` Scenario "Shell helper survives until orchestrator-native equivalent ships" explicitly anticipates this pattern — once the orchestrator provides a native equivalent that preserves all preconditions, the shell helper SHALL NOT be required. `vp test run` IS the native equivalent for unit tests. The shell helper had no preconditions beyond `cd "$ROOT"` (which `bunx vp` handles natively); preserving it would create a dead artifact.

**Alternatives considered**:

- Keep shell helper as a thin `bunx vp test run` wrapper: rejected (adds layer with no value; risks drift between the wrapper and the task definition)
- Keep shell helper for parallel CI use: rejected (CI already dispatches via `bunx vp run verify:unit:ts`, not the shell helper directly)

### Decision 4: `happy-dom` is added as an explicit root devDependency

**Rationale**: `bun-test/spec.md` Requirement "DOM test environment" preserves happy-dom (not jsdom) as the DOM environment. Under bun:test, happy-dom was bundled. Under vitest, happy-dom is opt-in via `test.environment` config AND must be installed as a peer/dev dep in the consumer project. Without explicit installation, vitest fails at test execution time when DOM-using tests load.

**Alternatives considered**:

- Use vitest's bundled jsdom: rejected (violates `bun-test/spec.md` Requirement "DOM test environment" which mandates happy-dom)
- Hope vp test bundles happy-dom: rejected (verified absent from `node_modules` post-`bun install`; vp test does NOT include happy-dom in its transitive runtime deps)

### Decision 5: `vitest` is added as an explicit root devDependency

**Rationale**: `@voidzero-dev/vite-plus-test@0.1.20` lists `@vitest/runner@4.1.5` and related vitest packages in its `devDependencies` (not `dependencies`), so they are NOT installed in the consumer's `node_modules`. Test files importing `from 'vitest'` would fail TypeScript type resolution AND runtime resolution without an explicit dep. Adding `vitest@^4.1.5` as a root devDependency aligns the consumer's vitest version with vp test's bundled version while decoupling the version pin from vp's internal updates.

**Alternatives considered**:

- Rely on vp test's internal vitest: rejected (devDependencies are not exposed; fails type resolution and runtime imports)
- Pin to a specific patch version like `4.1.5`: deferred (caret range `^4.1.5` allows minor security/bugfix updates while preserving major-version compat)

### Decision 6: `scripts/hygiene/*.test.ts` files are in scope (not skipped)

**Rationale**: vp test's discovery defaults (`**/*.{test,spec}.{ts,tsx}`) include `scripts/hygiene/*.test.ts`. If these files retain `bun:test` imports, vp test execution fails repo-wide on import resolution (verified empirically — `bunx vp test list` errored with `Cannot find package 'bun:test' imported from /Users/sugarat/workspace/animus/scripts/hygiene/delete-unused.test.ts`). Migrating them is non-optional unless they are excluded from vp test's discovery, which would create a divergence between bun:test scope and vp test scope (anti-pattern: scoped exclusions are debt).

**Alternatives considered**:

- Add `scripts/hygiene/**` to vitest's `exclude` config: rejected (preserves bun:test as a parallel test runner; double-runner state is not a stable end-state)
- Migrate hygiene tests to vitest: ACCEPTED (consolidates under single runner; scope expanded by 3 files but mechanically identical to package-side migrations)

## Risks / Trade-offs

**Risk 1**: vp test alpha-status behavioral surprises in edge cases (parameterized tests, snapshot timing, watch mode).

- **Mitigation**: Risk Acceptance section in proposal.md documents pre-GA exposure; baseline pass-count maintenance (~624/0/30 files) catches divergence at the verify gate; reversibility via revert-commit if a class of regression surfaces.

**Risk 2**: vitest API drift from bun:test beyond the documented `spyOn` translation.

- **Mitigation**: API survey in pre-flight (tasks §1) confirmed only `spyOn` translation needed; baseline pass-count is the empirical regression detector; if novel divergence surfaces, isolate via `bunx vp test run <single-file>` to localize.

**Risk 3**: happy-dom version drift between vitest's expected version and the explicit pin.

- **Mitigation**: Use a major-version range (`^15` or current stable) that vitest 4.x supports; document the version range as deliberate rather than pinned.

**Risk 4**: Pass-count regression masked by test-discovery differences (vitest finds files bun:test missed, or vice versa).

- **Mitigation**: Pre-flight task (§1) captures the explicit pre-rebind file list AND test count; post-rebind verification compares both counts; surplus or deficit files trigger investigation rather than archive.

## Migration Plan

The migration is reversible per the proposal's Risk Acceptance section. Order of operations within the change application:

1. **Pre-flight grounding** (§1 of tasks.md): capture baselines (test count, pass count, file enumeration) for post-change comparison
2. **Dependency additions** (§2): add `vitest`, `happy-dom` to root `package.json` devDependencies; run `bun install`
3. **vite.config.ts edits** (§3): add `test:` block, add `test` task, modify `verify:unit:ts` task command
4. **Test file import migrations** (§4): replace `from 'bun:test'` → `from 'vitest'` across 25 files; translate `spyOn` → `vi.spyOn` at one site
5. **Shell helper removal** (§5): delete `scripts/verify/unit-ts.sh`
6. **Package.json script updates** (§6): root `"test"` and `packages/_integration` `"test"` → use vp test
7. **Spec MODIFIED apply** (§7): authored in this change's `specs/bun-test/spec.md` delta
8. **CLAUDE.md edits** (§8): refresh references to `bun test` invocation in documentation
9. **Verification gate** (§9): run change-type-map verify-set + full `verify`
10. **Spec validation** (§10): `openspec validate migrate-test-to-vp-test --strict`
11. **Final state-sync** (§11): tick all tasks; status-confirm; hand-off for archive

**Rollback strategy**: a single `git revert <merge-commit>` restores `bun test` invocation, removes vitest/happy-dom deps, restores `scripts/verify/unit-ts.sh`, and reverts the spec MODIFIED block. No schema or data migrations are required.

## Open Questions

None. All architectural decisions are settled by the spec invariants, the explicit ARGUMENTS scope, and the empirical grounding (vp test capability surface, vitest API mapping, happy-dom requirement). The proposal is implementation-ready.
