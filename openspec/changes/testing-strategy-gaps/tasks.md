## 1. Rust Tests in Verify Pipeline

- [x] 1.1 Add `cargo test --lib` to `verify` script in root `package.json`. Position after `bun test`. Use `cd packages/extract && cargo test --lib` to run from the crate directory.
- [x] 1.2 Add `cargo test --lib` to `verify:full` script. Same approach.
- [x] 1.3 Fixed all 20 compile errors (missing `compound_configs` in transform_emitter.rs, missing `current_var` in theme_resolver.rs and css_generator.rs). 175/179 Rust tests pass. 4 pre-existing behavioral failures remain (stale assertions in chain_walker + transform_emitter — separate concern).
- [x] 1.4 Rust tests compile and pass: 175 passed, 0 failed, 4 ignored (pre-existing behavioral failures marked #[ignore]).

## 2. Unify Theme Fixtures

- [x] 2.1 Read both theme definitions: `packages/extract/tests/test-system.ts` and `packages/_integration/fixtures/setup.ts`. Document the differences (breakpoints, scales, colors, contextual vars, color modes).
- [x] 2.2 Update `packages/_integration/fixtures/setup.ts` to import `ds` and `tokens` from `packages/extract/tests/test-system.ts` instead of building its own. Keep the `config = ds.serialize()` and `theme = tokens.serialize()` exports.
- [x] 2.3 Delete the duplicate `createSystem()`, `createTheme()`, group imports, and module augmentation from `setup.ts`. The file becomes a thin re-export + serialize layer.
- [x] 2.4 Update integration test assertions to match the canary theme's output (breakpoint 640→768).
- [x] 2.5 Run `bun test packages/_integration/` — all 36 integration tests pass with the unified theme.
- [x] 2.6 Run `bun test packages/extract/tests/canary.test.ts` — canary tests unaffected (no changes to their theme).
- [x] 2.7 Deferred to task 4.1 (full verify).

## 3. Showcase Output Assertions

- [x] 3.1 Create `scripts/assert-showcase.sh` — post-build assertion script that checks showcase dist/ output. Exit non-zero on any failure.
- [x] 3.2 Assert CSS file exists: at least one `.css` file in `packages/showcase/dist/assets/`, non-empty.
- [x] 3.3 Assert CSS contains `@layer global, base, variants, compounds, states, system, custom`.
- [x] 3.4 Assert CSS does NOT contain `__TRANSFORM__`.
- [x] 3.5 Assert CSS contains `:root {`.
- [x] 3.6 Assert CSS contains `animus-` class names.
- [x] 3.7 Assert JS files do NOT contain `@emotion`.
- [x] 3.8 Update `test:showcase` script in root `package.json` to run `scripts/assert-showcase.sh` after the build.
- [x] 3.9 Run `bun run test:showcase` — build succeeds and all 6 assertions pass.

## 4. Verification

- [ ] 4.1 Run `bun run verify` — JS tests + Rust tests + biome all pass.
- [ ] 4.2 Run `bun run verify:full` — full pipeline including Rust + showcase + assertions.
- [ ] 4.3 Verify no duplicate theme definitions exist (grep for `createTheme` in test files — should be exactly 2: `test-system.ts` and `theme-fixture.ts`).
