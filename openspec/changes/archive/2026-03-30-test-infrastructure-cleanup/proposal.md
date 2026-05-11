## Why

The API surface has stabilized after 34 sessions of feature work, but the test infrastructure still carries structural debt from the rapid iteration period. Extract test fixtures (19 files + `serialize-config.ts`) import from `@animus-ui/core` — a package that isn't part of the 2-package consumer surface (`system` + `vite-plugin`). A 672-line file-based snapshot gets rubber-stamped on review. Recent features (compound variants, contextual vars, configurable breakpoints, compose(), `.system()` mixed namespace, disjoint namespace constraint) have limited type test coverage. Now is the right time to invest in sustainable patterns — the API is stable enough that this investment has a long shelf life.

## What Changes

- **Sever core dependency in extract tests**: Rewrite all 19 fixture files to use `@animus-ui/system` consumer API (`ds.styles(...)`) instead of `@animus-ui/core` (`animus.styles(...)`). Rewrite `serialize-config.ts` to import from system's `groups/` exports instead of core internals.
- **Formalize testing tiers**: Establish three tiers — unit (bottom-up, explicit assertions), type (compile-time, Assert<>/@ts-expect-error), integration/canary (top-down, inline snapshots for structure + explicit assertions for semantics).
- **Migrate to inline snapshots**: Replace file-based `__snapshots__/` with focused inline snapshots (`toMatchInlineSnapshot()`). Each snapshot guards CSS structure, stays under ~30 lines, and lives next to its assertion.
- **Expand type test coverage**: Add type assertions for recent features — compound variants, contextual vars, configurable breakpoints, compose() slots, `.system()` mixed namespace activation, disjoint namespace constraint.
- **Shared fixture architecture**: Create a shared test-system in extract tests (mirroring system's existing `test-system.ts`) that builds a real system via `createSystem()`, proving the consumer path works.

## Capabilities

### New Capabilities
- `test-strategy`: Testing tier definitions, snapshot policy, assertion pattern guidelines, "meet in the middle" testing philosophy (units push up, integration pushes down, middle validates through convergence)
- `self-contained-fixtures`: Extract test fixtures using consumer API, shared test-system built via createSystem(), serialized config derived from system's groups/ exports
- `type-coverage-expansion`: Type regression tests for compound variants, contextual vars, configurable breakpoints, compose(), .system() mixed namespace, disjoint constraint

### Modified Capabilities
- `bun-test`: Adding inline snapshot requirement (toMatchInlineSnapshot preferred over file-based), test.each for parameterized fixture testing

## Impact

- `packages/extract/tests/` — fixture rewrite (19 files), canary test restructure, serialize-config.ts migration, snapshot file deletion
- `packages/system/__tests__/` — type test expansion (types.test-d.tsx), possible theme.test.ts snapshot migration
- `packages/extract/src/lib.rs` — may need import cleanup logic updated to handle `@animus-ui/system` in addition to `@animus-ui/core` (consumed_sources array)
- `packages/extract/src/chain_walker.rs` — Rust internal test fixtures hardcode `@animus-ui/core` (observation only, restructuring Rust internals is out of scope)
- No consumer-facing API changes. No new dependencies. No breaking changes.
