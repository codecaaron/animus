## Context

504 tests across 5 tiers (Rust unit, JS unit, canary, integration, type, post-build) all pass. But the test suite's organization reflects when tests were written, not what behaviors they guard. The canary file (150 tests) uses component-oriented describe blocks. Integration files are named by pipeline stage. No manifest maps behaviors to test locations. The unresolved token invariant gap means raw token names can pass through extraction into CSS without detection.

Current file layout:
```
packages/extract/tests/canary.test.ts           — 150 tests, component-oriented describes
packages/_integration/__tests__/contract.test.ts — 5 tests, serialization shape
packages/_integration/__tests__/pipeline.test.ts — 9 tests, extraction behaviors
packages/_integration/__tests__/post-processing.test.ts — 24 tests, utility functions
packages/system/__tests__/compose.test.tsx       — 11 tests, SSR composition
```

## Goals / Non-Goals

**Goals:**
- Restructure canary.test.ts describe blocks to behavioral taxonomy (same file, same tests, new grouping)
- Rename integration files so file name = behavior tested
- Add composition integration test (compose() through extraction pipeline)
- Add token invariant guards (no raw unresolved tokens in CSS output)
- Convert repetitive patterns to `test.each()` parametrization
- Create TESTING.md behavioral manifest mapping 15 behaviors to test tiers + files

**Non-Goals:**
- Splitting canary.test.ts into multiple files (it tests one boundary — keep it monolithic)
- Adding type tests to core/theming packages (separate change)
- Changing Rust test organization (idiomatic embedded modules, leave as-is)
- Adding new fixture components (use existing fixtures)
- Changing post-build assertions or showcase tests

## Decisions

### 1. Behavioral describe blocks over component-oriented

Canary test describe blocks will be named by extraction BEHAVIOR, not by component:

```
BEFORE: "Canary: Button extraction", "Canary: Layout extraction"
AFTER:  "base style extraction", "variant resolution", "responsive generation"
```

A component is a vehicle for testing a behavior. The describe block names the behavior. Tests within may still reference the component fixture they use.

**Why not split into multiple files?** The canary tests one boundary (NAPI). 150 tests in one file is large but the file itself is the canary — its value is comprehensiveness at a single boundary. Splitting obscures that unity. Behavioral describe blocks give discoverability without fragmentation.

### 2. File naming = behavior naming for integration

```
contract.test.ts    → serialization.test.ts
pipeline.test.ts    → extraction.test.ts
(new)               → composition.test.ts
post-processing.test.ts  (unchanged — already behavioral)
```

"contract" is a meta-concept; "serialization" is the behavior. "pipeline" is a mechanism; "extraction" is the behavior.

### 3. Token invariant guard pattern

A reusable assertion helper that scans CSS for raw unresolved token names:

```ts
function assertNoUnresolvedTokens(css: string) {
  // Known token scale names from the shared theme
  const tokenScales = ['primary', 'secondary', 'background', 'text', 'danger', 'info'];
  for (const token of tokenScales) {
    expect(css).not.toMatch(new RegExp(`:\\s*${token}\\s*;`));
  }
}
```

Applied to every integration test that produces CSS output. This closes the gap where `bg: 'danger'` (a non-existent token) would produce `background-color: danger` and pass all assertions.

**Alternative considered:** A generic regex like `/property: [a-z]+;/` — too broad, catches valid CSS values like `display: flex`. Theme-aware token list is more precise.

### 4. test.each() parametrization

Applied where multiple inputs test the same behavior. Primary candidates:

- **Variant resolution**: Each variant option (size:small, size:medium, size:large) tests the same behavior with different expected values
- **Post-processing unit fallback**: Length vs non-length properties, each with multiple values
- **Token alias resolution**: Multiple alias patterns ({scale.key}, {scale.key/alpha}, compound values)

Pattern:
```ts
test.each([
  ['small', '0.875rem'],
  ['medium', '1rem'],
  ['large', '1.25rem'],
])('size variant "%s" resolves fontSize to %s', (size, expectedRem) => {
  expect(css).toContain(expectedRem);
});
```

### 5. TESTING.md as coverage certainty layer

A manifest at repo root that maps every system behavior to its test locations. Not prose documentation — a structured reference table. Updated when tests are added/moved.

Format: behavior → primary tier → file → secondary tier → file → assertion pattern

This is the "middle" of the edges-inward model — it doesn't test anything, but it answers "is X tested?"

## Risks / Trade-offs

**[Canary restructure may break snapshot update workflow]** → Tests keep the same assertions; only describe block nesting changes. `bun test --update-snapshots` will work identically.

**[File renames may break IDE test runners or CI caching]** → git mv preserves history. Bun test discovers by glob pattern, not explicit paths. No CI config references specific test files.

**[Token invariant list requires maintenance]** → The token list derives from the shared theme fixture. If the theme gains new scale names, the invariant list must be updated. Consider deriving it programmatically from `tokens.serialize()` in a future iteration.

**[TESTING.md becomes stale]** → Risk is real but low-cost to fix. The manifest is a reference, not an enforcement mechanism. Staleness means a human can't find a test — not that a test stops running.
