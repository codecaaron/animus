## Context

The Animus extraction pipeline has one production path:

```
buildStart():
  subprocess → import system → ds.serialize() + tokens.serialize()
  ↓
  analyzeProject(fileEntries, scalesJson, variableMapJson, contextualVarsJson, propConfig, groupRegistry, ...)
  ↓
  resolveTransformPlaceholders(css, transforms)   [subprocess, live functions]
  ↓
  applyUnitFallback(css)
  ↓
  CSS served via virtual:animus/styles.css
```

The vite-plugin orchestrates this inline — each step is a direct function call with the real NAPI binding. There is no abstraction layer between plugin and pipeline.

Current test coverage:
- **Canary tests** (`extract/tests/canary.test.ts`): Call `extract()` per-file and `analyzeProject()` multi-file with hand-maintained theme JSON + programmatic config JSON (via `serialize-config.ts`). Test Rust crate behavior directly.
- **No serialize → NAPI test**: Nobody verifies that `tokens.serialize()` output is valid NAPI input.
- **No post-processing tests**: `applyUnitFallback`, `resolveTransformPlaceholders`, `resolveGlobalStyles` have zero targeted tests.

The `packages/_integration/` workspace exists as a stale skeleton from the Emotion era (deps on `@animus-ui/core`, `@animus-ui/theming`, `@emotion/react`). It has no active tests.

## Goals / Non-Goals

**Goals:**
- Test the serialize → NAPI contract boundary with real builder output
- Test the full pipeline end-to-end: serialize → analyzeProject → post-process → assert CSS
- Add targeted unit tests for each post-processing utility
- Eliminate hand-maintained theme JSON from canary tests
- Remove the unused `runExtraction()` orchestrator that creates a divergent code path

**Non-Goals:**
- NOT testing the Vite plugin lifecycle (buildStart, transform, HMR, virtual modules)
- NOT testing subprocess ESM isolation — `serialize()` is pure, subprocess boundary doesn't change output
- NOT creating a new pipeline orchestrator or library — the harness is test code, not exported API
- NOT moving canary tests out of `packages/extract/` — they test per-file `extract()`, a valid unit test boundary
- NOT testing the Rust crate's internal behavior — canary tests already cover that

## Decisions

### 1. Integration workspace, not co-located tests

**Decision:** Tests live in `packages/_integration/`, not alongside the packages they test.

**Why:** These tests cross package boundaries — they import from both `@animus-ui/system` (serialize) and `@animus-ui/extract` (NAPI + post-processing). Co-locating them in either package would create a circular dependency or misrepresent ownership. The `_integration` prefix sorts it before other packages and signals its role.

**Alternative considered:** Adding integration tests to `packages/extract/tests/`. Rejected because it would require `extract` to depend on `system` as a devDep, blurring the package boundary. Extract processes what system describes — it shouldn't import system.

### 2. Shared fixture module, not per-test setup

**Decision:** A single `fixtures/setup.ts` builds the system+theme and serializes once. All tests import the pre-serialized output.

**Why:** Building and serializing is deterministic — same builder calls produce same JSON every time. Doing it once per suite avoids redundant work and makes the fixture a single source of truth. If the builder API changes, exactly one file breaks.

**Structure:**
```
packages/_integration/
  fixtures/
    setup.ts              ← createSystem() + createTheme() → serialized output
    components/
      button.tsx          ← Real builder chain components
      layout.tsx
      variants.tsx
      compounds.tsx
      responsive.tsx
      system-props.tsx
      transforms.tsx
  __tests__/
    contract.test.ts      ← serialize → NAPI round-trip
    pipeline.test.ts      ← full pipeline end-to-end
    post-processing.test.ts ← utility unit tests
```

**Alternative considered:** Each test file builds its own system+theme. Rejected because it duplicates setup and makes it unclear which fixture configuration is canonical.

### 3. Direct NAPI calls, no wrapper

**Decision:** Tests call `analyzeProject()` directly with the same argument signature the vite-plugin uses. No `runExtraction()` wrapper.

**Why:** The test should exercise the SAME code path as production. The vite-plugin calls `analyzeProject()` directly, then calls post-processing utilities directly. The test does the same. If we wrapped these in a convenience function, we'd be testing the wrapper, not the pipeline.

**Alternative considered:** Keep `runExtraction()` and use it as the test harness. Rejected because (a) the vite-plugin doesn't use it, so it's a divergent path, and (b) it hides the individual steps that integration tests should make explicit and assertable.

### 4. Fixture components use the real builder API

**Decision:** `.tsx` fixture files import from `@animus-ui/system` and use `createSystem()`, `asElement()`, etc. — the same API consumers use.

**Why:** If fixture files use a synthetic format or raw CSS strings, they don't exercise the extraction path consumers hit. The Rust crate parses real builder chain calls from AST — the fixtures must contain real builder chain calls.

### 5. Canary tests keep their home, get programmatic fixtures

**Decision:** Canary tests stay in `packages/extract/tests/`. Their hand-maintained theme JSON gets replaced with `tokens.serialize()` output from a shared fixture.

**Why:** Canary tests test the Rust crate's per-file `extract()` function — that's a unit test boundary within the extract package. Moving them to `_integration` would be misleading about what they test. But their theme JSON should come from the real builder to prevent contract drift.

**Mechanism:** A `fixtures/theme-fixture.ts` file in `extract/tests/` that calls `createTheme()` and exports the serialized output. Canary tests import from this instead of inline JSON. The config fixture (`serialize-config.ts`) already works this way — extend the pattern to theme.

### 6. Remove `runExtraction()` before adding integration tests

**Decision:** Delete `runExtraction()`, `ExtractionInput`, `ExtractionResult` from `extract/pipeline/index.ts` as the first task.

**Why:** If `runExtraction()` exists when integration tests are written, there's a gravitational pull to use it — it's convenient, it wraps everything. But it's a divergent path that the vite-plugin doesn't use. Removing it first ensures tests can't accidentally exercise the wrong path. All utility re-exports (`applyUnitFallback`, etc.) stay.

## Risks / Trade-offs

**[Risk] Canary tests break when switching to programmatic theme JSON** → The hand-maintained JSON may have subtle differences from `tokens.serialize()` output (key ordering, extra/missing entries, value formats). Mitigation: Compare old JSON to new serialize output before switching. Fix any Rust-side assumptions about input format.

**[Risk] Integration tests depend on Rust binary availability** → `analyzeProject()` requires the compiled `.node` binary. If binary is stale or missing, tests fail with unhelpful NAPI errors. Mitigation: Tests should call `clearAnalysisCache()` at setup. CI must build extract before running integration tests (already true in `verify` pipeline).

**[Trade-off] Fixture components overlap canary fixtures** → Both `_integration/fixtures/components/` and `extract/tests/fixtures/` will have button/layout/variant fixtures. This is intentional — canary fixtures test per-file extraction edge cases, integration fixtures test full-pipeline behavior. The overlap is in component shape, not test purpose.

**[Trade-off] No subprocess boundary testing** → Production uses subprocess for ESM isolation (theme evaluation) and transform resolution. Tests skip this. Acceptable because: (a) serialize() is pure — same input, same output regardless of process boundary; (b) subprocess behavior is a vite-plugin concern, explicitly a non-goal.
