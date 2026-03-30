## Why

An adversarial testing audit (red team + agnostic reviewer) converged on three gaps in the testing strategy. Each gap represents a class of silent regression that the current test suite cannot detect: Rust crate regressions invisible to CI (179 tests never run), theme fixture divergence between canary and integration tiers (different coverage surfaces undermine convergence), and showcase builds that succeed with broken CSS (zero output assertions).

## What Changes

- **Add `cargo test --lib` to verify scripts** — Expose the Rust crate's 179 internal unit tests (chain walker, style evaluator, theme resolver, CSS generator) in the standard `verify` and `verify:full` workflows. Currently only JS tests run.
- **Unify theme fixtures across test tiers** — Create a single shared theme definition importable by both `extract/tests/` and `_integration/`. Structurally modeled on the showcase theme. Eliminates the current divergence (canary has xs/sm/md/lg/xl breakpoints, integration has sm/md/lg; canary has contextual vars, integration doesn't).
- **Add automated showcase output assertions** — Extend `test:showcase` to verify the built output: CSS file contains `@layer` declarations, no `__TRANSFORM__` placeholders remain, no Emotion imports in JS bundle, class names follow `animus-` pattern, variable CSS contains `:root` block.

## Capabilities

### New Capabilities
- `showcase-output-assertions`: Automated post-build checks on showcase dist/ output that catch silent CSS loss, unresolved transforms, and runtime dependency leakage.

### Modified Capabilities
- `build-verification`: Adding `cargo test --lib` to verify scripts, making Rust unit tests part of the standard gate.
- `programmatic-test-fixtures`: Unifying theme fixtures to a single shared definition across test tiers, eliminating divergent coverage surfaces.
- `test-strategy`: Updating convergence model to require tier overlap via shared fixtures.

## Impact

- `package.json` — `verify` and `verify:full` scripts gain `cargo test --lib` step
- `packages/extract/tests/test-system.ts` — Theme definition updated to match unified fixture
- `packages/extract/tests/fixtures/theme-fixture.ts` — May be replaced by import from shared location
- `packages/_integration/fixtures/setup.ts` — Theme replaced by import from shared location
- `packages/_integration/__tests__/` — Assertions updated for new theme values (breakpoints, colors, scales)
- `packages/extract/tests/canary.test.ts` — Assertions updated for unified theme (snapshot updates, hash changes)
- Root scripts — `test:showcase` gains post-build assertion step
