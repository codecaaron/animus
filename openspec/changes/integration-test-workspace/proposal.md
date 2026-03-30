## Why

The canary tests in `packages/extract/tests/` are integration tests masquerading as unit tests. They import NAPI functions from extract, config from system's groups, construct a consumer-shaped theme, and run extraction against fixture files. This cross-package concern doesn't belong inside either package — it belongs at the intersection.

Session 35's test-infrastructure-cleanup revealed five specific tensions caused by this misplacement:

1. **Inline source strings test a dead code path.** 12 string literals in canary.test.ts still reference `import { animus } from '@animus-ui/core'` — a pattern no consumer uses. These are test data for the Rust extractor, but they exercise a code path that doesn't exist in the wild.

2. **The import-stripping test is vacuous.** The test at line ~1921 verifies that `@animus-ui/core` gets stripped from transformed output. But after the fixture migration, no fixture imports from core. And `consumed_sources` in the Rust crate now targets `@animus-ui/system`. The test passes trivially.

3. **test-system.ts theme is aspirational, not functional.** A full theme (scales, colors, modes, contextual vars) was built in test-system.ts, but the Rust crate never sees it — it receives a separate hand-maintained JSON string from canary.test.ts. The theme exists for IDE experience only.

4. **Layer 5 inline snapshot is 516 lines.** The design spec said "max ~30 lines per inline snapshot." Layer 5 was mechanically converted without splitting. It snapshots the full doc-site CSS output — far too coarse for diagnostic value.

5. **Fixtures look like consumer code but aren't type-checked at test time.** They're read as raw text via `readFileSync`. The tsconfig we added helps in-editor, but the test pipeline doesn't validate them.

## What Changes

- **Create `packages/_integration/` workspace** — a private package containing a fake consumer app (theme, system, components) and integration tests that exercise the extraction pipeline against it.
- **Move canary tests** from `packages/extract/tests/` to the integration workspace. Rewrite to use real files from the fixture app instead of `readFileSync` + hand-maintained JSON.
- **Dissolve serialize-config.ts** — the fixture app's `system.ts` IS the config. The test harness serializes from it the same way the vite-plugin does.
- **Dissolve inline source strings** — every extraction scenario becomes a real typed component in the fixture app.
- **Clean up extract package** — remove `tests/`, `test-system.ts`, `fixtures/`. Extract retains only Rust crate + NAPI binding + internal `#[test]` unit tests.

## Capabilities

### New Capabilities
- `integration-test-workspace`: Private workspace for cross-package integration testing. Fixture app with theme, system, and components. Tests exercise NAPI extraction functions against real consumer-shaped source files.

### Modified Capabilities
- `bun-test`: Test discovery paths change — integration tests found in `packages/_integration/tests/` instead of `packages/extract/tests/`.

## Impact

- `packages/extract/tests/` — entire directory removed (canary.test.ts, fixtures/, test-system.ts, serialize-config.ts)
- `packages/extract/package.json` — `@animus-ui/system` devDep and tsconfig can be removed (no JS tests remain)
- `packages/_integration/` — new workspace with devDeps on both `@animus-ui/system` and `@animus-ui/extract`
- Root `package.json` — `workspaces` array gains `packages/_integration`
- Root `package.json` — `test:canary` script path changes
- `bun run verify` / `verify:full` — canary tests still run, just from new location

---

## Gotchas for Next Session

### Things to explore first (before designing)

1. **How does the vite-plugin serialize the system config for the Rust crate?** The integration workspace should use the same serialization path — not a hand-maintained `serialize-config.ts`. Look at `packages/vite-plugin/src/` for how it evaluates the system and passes config/groupRegistry to the NAPI functions. The integration test harness should mirror this.

2. **How does the vite-plugin evaluate the theme?** Same question — the theme JSON that currently lives as a hand-maintained blob in canary.test.ts should be produced by the same evaluation path the plugin uses. Look at `theme-evaluator.ts`.

3. **What do the inline source string tests actually cover?** Read the test sections around lines 347, 382, 411, 1885, 2760, 2803 in canary.test.ts carefully. Some may test scenarios not covered by the fixture files (e.g., synthetic multi-file scenarios, edge cases in import resolution). Map each inline string to a scenario and decide: does this become a fixture component, or is it genuinely testing a parse-level edge case that belongs as a Rust #[test]?

4. **The import-stripping test needs rethinking.** It should verify that dead imports from `@animus-ui/system` get cleaned up. But in consumer code, `@animus-ui/system` imports are rarely dead (you import `createSystem`, `compose`, etc. alongside the builder). Think about what the test should ACTUALLY prove.

### Things to NOT do

- **Don't try to make the fixture app buildable with Vite.** It's not a real app — it's a set of source files for the extraction pipeline to consume. It needs to be valid TypeScript, but it doesn't need to render in a browser. The showcase already serves as the end-to-end proof.

- **Don't move the Rust internal tests.** The 179 `#[test]` tests stay inside the extract crate. They're genuine unit tests of Rust functions. Only the JS-side canary tests move.

- **Don't fix the Rust internal test compilation failures as part of this change.** The 20 errors in `cargo test --lib` (missing `compound_configs` in transform_emitter.rs tests) are a separate concern. They should be a separate change — they require updating Rust test fixtures to match current struct signatures.

- **Don't create a tsconfig that compiles the fixture app to JS.** The fixture app is source-only. `noEmit: true`. Type checking is the point, not compilation.

### Things to keep in mind

- The `animus-` class name prefix is framework-level, not derived from the root identifier name. Changing fixture variable names (`ds` vs `animus` vs `system`) does NOT change class names or extraction output.

- The config diff between core's groups and system's groups (40 added, 26 removed, 1 changed) had zero impact on canary test assertions. The added props are aliases (e.g., `w` for `width`), the removed props are old naming conventions (e.g., `borderColorTop` → `borderTopColor`). No existing fixture used the renamed props.

- The showcase already proves end-to-end extraction works. The integration tests should focus on controlled scenarios with targeted assertions — NOT replicate the showcase's breadth.

- `bun test` discovers test files by glob patterns. The new workspace just needs `*.test.ts` files and bun will find them automatically.
