## Context

The testing strategy audit (session 37) used red team and agnostic reviewers to evaluate the three-tier convergence model. Both reviewers independently converged on the same three highest-value gaps:

1. 179 Rust tests never run in CI (`verify` has no `cargo test`)
2. Two divergent theme fixtures undermine the convergence axiom
3. Showcase builds succeed with broken CSS (no output assertions)

Current state:
- `verify`: `build:ts && compile && bun test && test:types && check`
- `verify:full`: `build:all && bun test && check && test:showcase`
- `test:showcase`: `bun run --filter './packages/showcase' build`
- Canary theme: `test-system.ts` (xs/sm/md/lg/xl breakpoints, 14 space entries, contextual vars, 10 colors)
- Integration theme: `setup.ts` (sm/md/lg breakpoints, 7 space entries, no contextual vars, 7 colors)

## Goals / Non-Goals

**Goals:**
- Rust unit tests gate every `verify` run
- One theme fixture, two consumers (canary + integration)
- Showcase build produces verifiable output with automated checks

**Non-Goals:**
- Vite plugin lifecycle tests (expensive, needs feasibility spike)
- Visual regression testing (Chromatic infrastructure)
- Performance benchmarks
- Fixing Rust compile errors in transform_emitter.rs (separate concern)
- Subprocess error recovery hardening

## Decisions

### 1. `cargo test --lib` placement in verify pipeline

**Decision:** Add to both `verify` and `verify:full`, positioned after `bun test` (JS tests gate Rust tests, not the other way around — JS tests are faster and catch most regressions first).

**Why not `verify` only:** `verify:full` is the comprehensive gate. Omitting Rust tests from it would be inconsistent.

**Why `--lib` not `cargo test`:** `--lib` runs only library tests (the 179 unit tests in src/*.rs), skipping doc tests and integration tests. The 20 compile errors in transform_emitter.rs are in `#[cfg(test)]` blocks within the lib — `cargo test --lib` will report them. We accept this: the errors are pre-existing and known. If they block, we can add `-- --skip transform_emitter` temporarily.

**Alternative considered:** Only add to `verify:full`. Rejected because Rust tests run in ~2s — no reason to skip them in the fast path.

### 2. Shared theme fixture location

**Decision:** The unified theme lives in `packages/extract/tests/test-system.ts` (where it already is). The integration workspace imports from there via relative path or workspace resolution.

**Why extract/tests, not a new shared location:** `test-system.ts` already exists, already has the richer theme, already exports `ds` and `tokens`. Creating a third location adds complexity. The integration workspace's `setup.ts` becomes a thin re-export that imports `ds`, `tokens` from the canary fixture and adds `config = ds.serialize()`, `theme = tokens.serialize()`.

**Why not _integration owns it:** The canary fixtures (18 .tsx files) import `ds` from `../test-system`. Moving the system definition away from them would require rewriting all import paths. Cheaper to have integration import from extract/tests.

**Theme convergence:** The unified theme uses the canary theme's richer structure (xs/sm/md/lg/xl breakpoints, full color set, contextual vars). The integration workspace's simpler theme (sm/md/lg, fewer colors) is deleted. Integration test assertions are updated to match the richer theme's output.

**Alternative considered:** New `packages/_shared-fixtures/` workspace. Rejected — over-engineering for two consumers.

### 3. Showcase output assertions approach

**Decision:** A shell script (`scripts/assert-showcase.sh`) that runs after `vite build` in `test:showcase`. Uses `grep` checks on `dist/` output. Not a test file — not discovered by `bun test`.

**Why script, not test file:** The showcase is a build artifact. Adding a `.test.ts` to it would require devDeps on bun-types, add it to the test suite, and blur the line between "build proof" and "test workspace." A post-build script keeps the showcase as a build target with verification bolted on.

**What it checks:**
1. `dist/assets/*.css` exists and is non-empty
2. CSS contains `@layer global, base, variants, compounds, states, system, custom`
3. CSS does NOT contain `__TRANSFORM__` (all placeholders resolved)
4. JS files do NOT contain `@emotion` imports
5. CSS contains `:root {` (variable declarations present)
6. CSS contains `animus-` class names

**Why these specific checks:** Each catches a specific silent failure mode identified by the audit:
- Missing CSS file → extraction didn't run
- Missing `@layer` → CSS structure corrupted
- Remaining `__TRANSFORM__` → transform subprocess failed
- Emotion imports → runtime dependency leaked
- Missing `:root` → variable CSS not emitted
- Missing `animus-` → class generation broken

## Risks / Trade-offs

**[Risk] `cargo test --lib` fails on pre-existing errors** → The 20 compile errors in transform_emitter.rs will cause `cargo test --lib` to fail. Mitigation: use `cargo test --lib 2>&1 || true` initially, or skip the module with `-- --skip transform_emitter`. Document the known state.

**[Risk] Theme unification breaks canary assertions** → Canary tests have inline snapshots and explicit assertions tied to the current theme's output. Changing the theme means updating assertions. Mitigation: this is mechanical — same process as session 37's theme-fixture migration. Run, diff, update.

**[Trade-off] Integration tests lose their minimal theme** → The integration workspace currently tests with a stripped-down theme, which validates that extraction works with minimal configuration. Unifying loses this signal. Acceptable: canary tests with zero scales already test bail/skip behavior.

**[Trade-off] Showcase assertions are grep-based, not structural** → Checking for string presence is fragile. A future CSS format change could break assertions. Acceptable: these are smoke checks, not deep validation. The convergence model handles structural correctness.
