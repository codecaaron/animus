## Context

506 tests across 4 domains (179 Rust internal, 182 extract canary, 58 system runtime, ~60 system type, 27 vite-plugin). System and vite-plugin tests are already self-contained. The extract package is the structural debt: all 19 fixture files import `animus` from `@animus-ui/core`, and `serialize-config.ts` reaches into `../../../../packages/core/src/config` and `../../../../packages/core/src/transforms`.

The Rust chain walker detects builder chains **structurally** — it walks backwards from `.asElement()` terminals through `.styles()`, `.variant()`, `.states()`, `.system()` calls regardless of the root identifier name or import source. The showcase already proves this: components use `ds.styles({...})` where `ds` comes from `createSystem()` via `@animus-ui/system`, and extraction works. The `@animus-ui/core` references in `lib.rs` (lines 321-329, 835-849) are **only** for import cleanup in the transformed output — they don't affect chain detection.

Bun is the test runner. It supports `toMatchInlineSnapshot()`, `test.each`, custom snapshot serializers, and all standard lifecycle hooks. Type testing uses `tsc --noEmit` on `.test-d.tsx` files — the bun-idiomatic pattern.

## Goals / Non-Goals

**Goals:**
- Zero imports from `@animus-ui/core` or `@animus-ui/theming` in any test file across system, extract, or vite-plugin
- Every extract fixture tests the consumer code path (`ds.styles()` from system), not the internal path (`animus.styles()` from core)
- Formalized testing tier definitions that map test tools to test purposes
- Inline snapshots for CSS structure, explicit assertions for semantic correctness
- Type test coverage for all features shipped since session 21 (compound variants through disjoint constraint)

**Non-Goals:**
- Restructuring Rust internal tests (`#[test]` in `.rs` files) — they're already strong (179 tests, self-contained)
- Adding E2E browser tests or Playwright integration
- Changing the test runner (staying with bun:test)
- Achieving 100% code coverage — the "meet in the middle" philosophy means the convergence zone is implicitly covered
- Modifying the `@animus-ui/core` package itself

## Decisions

### 1. Fixture migration: consumer API pattern

**Decision:** Rewrite extract fixtures to use a shared `test-system.ts` that creates a real system via `createSystem()` from `@animus-ui/system`, matching the showcase's `ds.ts` pattern.

**Rationale:** The chain walker is structural — it detects method chains by pattern, not import source. The showcase proves `ds.styles({...})` works identically to `animus.styles({...})` for extraction. Using the consumer API in fixtures means we're testing the same code path consumers actually use, which is strictly stronger than testing the internal path.

**Alternative considered:** Keep fixtures importing from core but add a test-only alias. Rejected — this hides the dependency rather than eliminating it, and doesn't test the consumer path.

**Pattern:**
```typescript
// extract/tests/test-system.ts
import { createSystem } from '@animus-ui/system';
import { space, color, typography, flex, layout, border, ... } from '@animus-ui/system/groups';

const { system: ds } = createSystem()
  .addGroup('space', space)
  .addGroup('color', color)
  // ... matching the canary test's theme scale set
  .build();

export { ds };
```

```typescript
// extract/tests/fixtures/button.tsx (rewritten)
import { ds } from '../test-system';

const ButtonContainer = ds
  .styles({ display: 'inline-flex', ... })
  .variant({ prop: 'variant', variants: { fill: { bg: 'primary' } } })
  .asElement('button');
```

### 2. Config serialization: derive from system's groups

**Decision:** Rewrite `serialize-config.ts` to import prop groups from `@animus-ui/system/groups` and transforms from `@animus-ui/system` instead of reaching into core internals.

**Rationale:** System's `groups/index.ts` exports the identical prop group definitions (color, border, flex, grid, space, typography, layout, positioning, shadows, background, transitions). System's `index.ts` exports the transforms (size, borderShorthand, gridItem, gridItemRatio). The serialization logic is identical — only the import paths change.

**Alternative considered:** Inline the serialized config as a static JSON blob. Rejected — this defeats the "programmatic from source of truth" principle. If system's groups change, the serialization should change with it.

### 3. Snapshot strategy: inline-only

**Decision:** Migrate all file-based snapshots to inline snapshots. Delete `__snapshots__/` directories.

**Rationale:**
- Inline snapshots live next to the assertion — reviewable in PR diffs without navigating to a separate file
- Ecosystem convergence: Panda CSS and Vanilla Extract both use `toMatchInlineSnapshot()`
- Current file-based canary snapshot (672 lines) is large enough to get rubber-stamped on review
- Inline snapshots enforce focus: each snapshot must be small enough to fit in the test, which naturally prevents the "200-line blob" problem

**Policy:**
- Snapshots for STRUCTURE: layer ordering, class naming pattern, @media nesting shape. Guard "did the output shape change?"
- Explicit assertions for SEMANTICS: correct CSS property values, correct layer placement, correct class names. Guard "is the right value in the right place?"
- Maximum ~30 lines per inline snapshot. If a snapshot grows beyond that, split into multiple focused assertions.

**Alternative considered:** Keep file-based snapshots but add a review policy. Rejected — the tooling doesn't enforce review policies, and the 672-line file proves the pattern leads to rubber-stamping.

### 4. Rust import cleanup: replace consumed_sources

**Decision:** Replace `@animus-ui/core` with `@animus-ui/system` in the `consumed_sources` array in `lib.rs`. Straight swap, not "alongside."

**Rationale:** `@animus-ui/core` is not the consumer package — nobody should be importing from it. The consumer surface is `@animus-ui/system`. In practice, most consumer code and test fixtures use relative imports for the `ds` builder (from their own `system.ts` or `test-system.ts`), so consumed_sources won't fire for those. But when it does apply (e.g., if someone imports the builder factory directly from the package), it should reference the correct package.

**Note:** For the rewritten test fixtures specifically, the `ds` import comes from `../test-system` (relative), so consumed_sources won't match. This is correct — the relative import stays because the test-system file may export other things.

### 5. Type test coverage: audit-driven, not assumption-driven

**Decision:** After full audit of `types.test-d.tsx` (951 lines), the existing coverage is substantially stronger than initially estimated. Most recent features already have thorough type assertions:

**Already covered (no work needed):**
- Compound variants (§7, §7b) — conditions, arrays, ordering enforcement
- Contextual vars (§12) — phantom types, currentVar, scale constraints, nonexistent scale rejection
- compose() (§10a-10f) — SharedConfig, VariantPropsOf, sealed output, shared config validation
- .system() mixed namespace (§13, §13d) — groups, individual props, ungrouped props, callsite exposure, responsive syntax
- Overlap tolerance (§13b), ungrouped props (§13c)
- Disjoint namespace (§13e) — both collision directions

**Genuine gap:**
- Configurable breakpoints: no negative assertion for invalid breakpoint keys in responsive objects (e.g., `@ts-expect-error — 'xxl' is not a breakpoint`). The implicit test (`p={{ _: 4, md: 16 }}`) only validates positive cases.

**Rationale for minimal expansion:** Adding assertions for things already covered creates maintenance burden without coverage value. The audit revealed the existing type tests are comprehensive — only breakpoint key narrowing needs explicit negative assertions.

### 6. Fixture migration strategy: parallel flight

**Decision:** Create new consumer-API fixtures alongside old core-API fixtures. Run canary tests against both to verify behavioral equivalence. Once confident, swap: delete old fixtures, update canary test imports.

**Rationale:** A blind in-place rewrite risks subtle extraction differences between the `animus` builder (core) and the `ds` builder (system). Parallel flight lets us diff the extraction output: CSS should be structurally identical except for class name hashes (which change because the root identifier changes from `animus` to `ds`). If structural CSS differs beyond class names, something is wrong.

**Sequence:**
1. Create new fixtures in `fixtures/` (overwrite or alongside, TBD based on naming)
2. Create new serialize-config from system's groups
3. Run canary tests with new config — capture extraction output
4. Compare CSS structure between old and new (ignoring class name hashes)
5. If equivalent: commit. If divergent: investigate before proceeding.
6. Update all canary test assertions to reference new class name patterns
7. Delete old core-importing fixtures

**Alternative considered:** In-place rewrite with manual verification. Rejected — too easy to miss subtle differences, and the cost of parallel flight is just temporary disk space.

### 7. Testing tier definitions

**Decision:** Three tiers with clear tool-to-purpose mappings.

| Tier | Direction | Tools | Purpose |
|------|-----------|-------|---------|
| Unit | Bottom-up | `.toBe()`, `.toEqual()`, `.toContain()` | Guard individual function behavior |
| Type | Compile-time | `tsc --noEmit`, Assert<>, @ts-expect-error | Guard API surface narrowness |
| Integration/Canary | Top-down | `toMatchInlineSnapshot()` + explicit assertions | Guard pipeline output correctness |

**Philosophy:** Units push up from the bottom (individual functions don't regress). Integration pushes down from the top (full pipeline produces correct output). The wiring in the middle is covered by convergence — if both pass, the middle is implicitly validated. No mocks in the middle.

## Risks / Trade-offs

**[Fixture rewrite scope]** → 19 fixture files + serialize-config.ts + canary test assertions that reference specific output patterns. The inline snapshot migration means every assertion that currently references the file-based snapshot needs to be rewritten as either an inline snapshot or explicit assertion. **Mitigation:** The canary test already has many explicit assertions alongside snapshots — the snapshot sections are a subset, not the whole test.

**[Chain detection compatibility]** → Changing fixtures from `animus.styles()` to `ds.styles()` changes the root identifier name. The chain walker returns the identifier name, which flows into class name generation (`animus-ComponentName-hash`). Class names in assertions will change. **Mitigation:** This is expected and correct — the class names should reflect the actual identifier used. Inline snapshots will capture the new names. Run all canary tests to verify extraction still works.

**[Inline snapshot maintenance]** → Inline snapshots live in the test file, making the test file longer. If CSS output changes, every inline snapshot in the file needs updating. **Mitigation:** `bun test --update-snapshots` handles this. And the tradeoff is worth it: longer test files with visible assertions vs. shorter test files with invisible 672-line snapshot files.

**[serialize-config.ts parity]** → The system's groups must export the identical prop definitions as core's config for the canary tests to produce identical results. **Mitigation:** System's groups ARE the source of truth now. Any divergence between system and core is a bug in the package boundary, not in the tests.
