## 1. Shared Extract Test System

- [x] 1.1 Create `packages/extract/tests/test-system.ts` — build a real system via `createSystem()` from `@animus-ui/system`, adding all prop groups from `@animus-ui/system/groups`. Export `ds` builder instance. Include theme with scales matching current canary test theme JSON.
- [x] 1.2 Rewrite `packages/extract/tests/fixtures/serialize-config.ts` — import prop groups from `@animus-ui/system/groups` and transforms from `@animus-ui/system` instead of core internals. Diff serialized output against current to verify equivalence.
- [x] 1.3 Verify canary tests still pass with new serialize-config (run `bun run test:canary`). This gates all subsequent fixture work.

## 2. Fixture Migration (Parallel Flight)

- [x] 2.1 Create first new fixture: `button.tsx` using `ds` from test-system. Keep old fixture accessible for comparison. Run extraction on both — diff CSS output (ignoring class name hashes) to verify structural equivalence.
- [x] 2.2 Once button equivalence confirmed, rewrite remaining fixtures in batch: `layout.tsx`, `system-props.tsx`, `bail.tsx`, `compound-variants.tsx`, `variant-groups.tsx`, `custom-props.tsx`.
- [x] 2.3 Rewrite second batch: `token-alias.tsx`, `contextual-vars.tsx`, `as-class.tsx`, `negative-margin.tsx`, `per-property-bail.tsx`, `reconciliation.tsx`.
- [x] 2.4 Rewrite extension chain pair: `extension-parent.tsx` and `extension-child.tsx`.
- [x] 2.5 Rewrite cross-package fixtures: `pkg-barrel/` and `pkg-consumer.tsx`.
- [x] 2.6 Run full canary suite (`bun run test:canary`) with all new fixtures — all tests must pass. Verify zero `@animus-ui/core` imports remain in fixtures.

## 3. Canary Test Snapshot Migration

- [x] 3.1 Identify all `toMatchSnapshot()` calls in `canary.test.ts` and their corresponding entries in `__snapshots__/canary.test.ts.snap`.
- [x] 3.2 Convert Layer 1 snapshot (styles + variants CSS) to inline snapshot(s). Split if over ~30 lines — use one inline snapshot per layer block.
- [x] 3.3 Convert Layer 3 snapshot (multi-file extension chain) to inline snapshot(s).
- [x] 3.4 Convert any remaining file-based snapshots to inline or explicit assertions.
- [x] 3.5 Delete `packages/extract/tests/__snapshots__/` directory.
- [x] 3.6 Run `bun run test:canary` — all canary tests pass with inline snapshots.

## 4. System Test Snapshot Migration

- [x] 4.1 Identify all `toMatchSnapshot()` calls in `packages/system/__tests__/theme.test.ts`.
- [x] 4.2 Convert theme snapshot assertions to inline snapshots. Split large snapshots into focused per-concern inline snapshots (root variables, mode variables, breakpoint variables separately).
- [x] 4.3 Delete `packages/system/__tests__/__snapshots__/` directory.
- [x] 4.4 Run `bun test packages/system/` — all system tests pass.

## 5. Rust Import Cleanup

- [x] 5.1 Replace `@animus-ui/core` with `@animus-ui/system` in `consumed_sources` at `lib.rs` ~line 324 and ~line 844. Straight swap.
- [x] 5.2 Run `bun run test:canary` and `cargo test --lib` to verify no regressions. (Canary: 150 pass. Rust internal: pre-existing compile error in transform_emitter.rs tests — out of scope.)

## 6. Type Test Gap Fill

- [x] 6.1 Add configurable breakpoints negative assertions to `types.test-d.tsx` — verify that invalid breakpoint keys in responsive objects produce type errors (e.g., `@ts-expect-error — 'xxl' is not a breakpoint`).
- [x] 6.2 Run `bun run test:types` — all type tests pass including new assertions.

## 7. Verification & Cleanup

- [x] 7.1 Run `bun run verify` — full TS build + test + biome check passes.
- [x] 7.2 Grep across all test files in system, extract, vite-plugin for any remaining `@animus-ui/core` or `@animus-ui/theming` imports. Zero actual imports found. 12 string literal references remain in canary.test.ts (inline source snippets for extraction testing — test data, not dependencies).
- [x] 7.3 Verify no `__snapshots__/` directories exist in system, extract, or vite-plugin packages.
- [x] 7.4 Run `bun run verify:full` — full pipeline including Rust build + showcase passes.
