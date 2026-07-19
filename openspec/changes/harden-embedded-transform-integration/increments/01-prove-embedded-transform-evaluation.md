# Increment 01: Prove Embedded Transform Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to implement this plan task by task.
> Steps use checkbox (`- [ ]`) syntax for tracking. Treat checkpoints as
> logical only: this repository forbids mutative git operations.

**Goal:** Make the integration suite prove that a real, self-contained named
transform executes inside the Rust extraction engine and make the shared test
helper mirror current consumer behavior.

**Architecture:** A real TSX fixture overrides the serialized `size` transform
with a callback whose `8px` result differs from every fallback. The integration
test asserts raw NAPI CSS directly; the shared helper then applies only the unit
fallback, matching Vite and Next.

**Tech Stack:** TypeScript/TSX, Vitest, Rust NAPI extractor, Vite+, OpenSpec
OODA, RepoWise distillation.

---

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1,D2,D3,D4,D5
- **Authors**: — (the envelope already contains
  §pipeline-integration-testing/Full pipeline end-to-end test)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**:
  `packages/_integration/**,openspec/changes/harden-embedded-transform-integration/**,openspec/specs/pipeline-integration-testing/spec.md`
- **Pushes to a later increment**: none

> Resolving signal that licensed creating this increment now: envelope license
> for decided-now D1-D5; no deferred Ledger row is resolved here.

## Context Capsule

- **Objective**: Replace a conditional test that can pass without exercising a
  transform with a discriminating assertion against raw NAPI CSS. Remove the
  obsolete TypeScript placeholder pass from the shared integration helper and
  update its local documentation. Do not change production extractor or plugin
  behavior.
- **Current defect**: locate `describe('transform resolution')` in
  `packages/_integration/__tests__/extraction.test.ts`. It currently imports
  `resolveTransformPlaceholders` and only asserts inside:

  ```ts
  if (rawCss.includes('__TRANSFORM__')) {
    const resolved = resolveTransformPlaceholders(rawCss, config.transforms);
    expect(resolved).not.toContain('__TRANSFORM__');
  }
  ```

  The paired fixture uses `.props({ sizing: { property: 'flexBasis',
  transform: 'size' } })`, so current NAPI output contains `flex-basis: 100`
  and no marker. The assertion therefore runs zero times.
- **Production boundary evidence**: `packages/vite-plugin/src/index.ts` and
  `packages/next-plugin/src/plugin.ts` both describe manifest CSS as fully
  Rust-resolved, then call only `applyUnitFallback`. The exported placeholder
  resolver retains focused compatibility coverage in
  `packages/_integration/__tests__/post-processing.test.ts` and is not removed.
- **Discriminating oracle**: the real fixture must define
  `createTransform('size', value => typeof value === 'number' ?
  `${value * 2}px` : value)` and style `width: 4`. The expected raw NAPI value
  is `width: 8px`; raw fallback and the built-in transform both yield `4px`.
- **In-scope guardrails**:
  - G1: The change SHALL NOT modify the calibrated contents of the two Rust
    transform authorities — STOP. Check:

    ```bash
    shasum -a 256 packages/extract/src/theme_resolver.rs packages/extract/crates/extract-v2/src/theme.rs
    ```

    Expected hashes:

    ```text
    c87c4ec9ccc833e22f510ba7a5bbac03209d777d1a1698df833ef5e82052a79f  packages/extract/src/theme_resolver.rs
    d44ffaff43500783117b4341aff2efaa9f41da84396573413f1ecd9e9120c2c1  packages/extract/crates/extract-v2/src/theme.rs
    ```

  - G2: Production Vite and Next plugin source SHALL NOT gain TypeScript
    placeholder resolution — STOP. Check:

    ```bash
    ! rg -n "resolveTransformPlaceholders" packages/vite-plugin/src packages/next-plugin/src
    ```

  - G3: The named-transform integration assertion SHALL NOT remain conditional
    on a marker already existing — STOP. Check:

    ```bash
    ! rg -n "if \\(rawCss\\.includes\\('__TRANSFORM__'\\)\\)" packages/_integration/__tests__/extraction.test.ts
    ```

  - G4: The authoritative integration helper SHALL NOT post-process transform
    placeholders — STOP. Check:

    ```bash
    ! rg -n "resolveTransformPlaceholders" packages/_integration/__tests__/run-pipeline.ts
    ```

  - G5: The canonical pipeline capability Purpose SHALL NOT name TypeScript
    placeholder resolution as part of the production path — STOP. Check:

    ```bash
    ! sed -n '/^## Purpose$/,/^## Requirements$/p' openspec/specs/pipeline-integration-testing/spec.md | rg -n 'resolveTransformPlaceholders'
    ```

- **Requirements to draft**: none; the orchestrator already authored the full
  modified behavioral requirement in the change-level delta tree.
- **Existing spec context**: the full replacement is at
  `openspec/changes/harden-embedded-transform-integration/specs/pipeline-integration-testing/spec.md`
  under `Full pipeline end-to-end test`. It requires raw NAPI CSS to contain a
  self-contained fixture callback's computed value and no `__TRANSFORM__`
  marker.
- **Relevant resolved decisions**:
  - D1: `runPipeline` consumes Rust-resolved CSS and applies unit fallback only.
  - D2: the fixture overrides `size` with a callback that doubles a numeric
    width.
  - D3: the test asserts `width: 8px` and marker absence directly.
  - D4: the change-level delta owns the requirement correction; the canonical
    Purpose is corrected directly because archive preserves the preamble.
  - D5: production Rust and plugin behavior remain untouched.
- **Upstream inputs**: none.
- **In-scope North Star criteria**: NS1 production-boundary evidence; NS2
  unconditional assertions; NS3 verified analyzer leads; NS4 helper parity
  with supported consumers.
- **Prohibitions**: no version-control mutation; do not stage, commit, switch,
  reset, merge, push, restore, or discard. Do not write outside the declared
  footprint. In delegate mode, do not edit `design.md`, `tasks.md`,
  `journal.md`, or `specs/`; return any proposed cockpit entry to the
  orchestrator. Preserve unrelated working-tree increments.

## Plan

## Task 01.1: Establish the failing raw-NAPI oracle

**Files:**

- Modify: `packages/_integration/__tests__/extraction.test.ts`
- Test: `packages/_integration/__tests__/extraction.test.ts`

- [x] **Step 1:** Remove the
  `resolveTransformPlaceholders` import and replace the first transform test
  with the following direct assertions; keep the existing real NAPI call and
  its serialized arguments unchanged.

  ```ts
  test('evaluates extracted named transforms in Rust', () => {
    const entry = readFixtureFile(COMPONENTS, 'transforms.tsx');
    const manifestJson = analyzeProject(
      JSON.stringify([entry]),
      theme.scalesJson,
      theme.variableMapJson,
      theme.contextualVarsJson || null,
      config.propConfig,
      config.groupRegistry,
      '{}',
      false,
      null
    );

    const manifest = JSON.parse(manifestJson);
    const rawCss: string = manifest.css || '';

    expect(rawCss).toContain('width: 8px');
    expect(rawCss).not.toContain('__TRANSFORM__');
  });
  ```

- [x] **Step 2:** Run the focused integration test against the old fixture.

  ```bash
  repowise distill bunx vp test run packages/_integration/__tests__/extraction.test.ts
  ```

  Expected: non-zero exit; `evaluates extracted named transforms in Rust`
  fails because the received CSS does not contain `width: 8px`. If RepoWise
  emits an omission marker, expand it rather than rerunning.

## Task 01.2: Make the real fixture exercise embedded evaluation

**Files:**

- Modify: `packages/_integration/fixtures/components/transforms.tsx`
- Test: `packages/_integration/__tests__/extraction.test.ts`

- [x] **Step 1:** Replace the stale string-transform fixture with this real,
  self-contained named transform and component.

  ```tsx
  import { createTransform } from '@animus-ui/system';

  import { ds } from '../setup';

  export const doubleSize = createTransform('size', (value) =>
    typeof value === 'number' ? `${value * 2}px` : value
  );

  export const Card = ds.styles({ width: 4 }).asElement('div');

  export function CardExample() {
    return <Card />;
  }
  ```

- [x] **Step 2:** Rerun the focused integration test.

  ```bash
  repowise distill bunx vp test run packages/_integration/__tests__/extraction.test.ts
  ```

  Expected: exit 0; the named-transform test observes `width: 8px` and no
  legacy placeholder.

## Task 01.3: Make the shared helper production-faithful

**Files:**

- Modify: `packages/_integration/__tests__/run-pipeline.ts`
- Modify: `packages/_integration/CLAUDE.md`
- Test: all `packages/_integration/__tests__/**`

- [x] **Step 1:** In `run-pipeline.ts`, import only `applyUnitFallback`, update
  the module comment to say `NAPI embedded transform evaluation → unit
  fallback`, and replace the mutable CSS plus conditional resolver with:

  ```ts
  const manifest = JSON.parse(manifestJson);
  const css = applyUnitFallback(manifest.css || '');

  return { manifest, css };
  ```

- [x] **Step 2:** In `packages/_integration/CLAUDE.md`, describe the helper as
  `analyzeProject()` with in-process transform evaluation followed by
  `applyUnitFallback()`. Change the permitted ES-import example to
  `applyUnitFallback`, and list `resolveTransformPlaceholders` under the
  compatibility-focused `post-processing.test.ts` coverage instead of the
  authoritative pipeline.

- [x] **Step 3:** Run the repository-mandated integration claim.

  ```bash
  repowise distill vp run verify:integration
  ```

  Expected: exit 0; all integration test files and tests pass. Any
  `__TRANSFORM__` output exposed by removing the helper resolver is a real
  production-parity failure and stops the increment.

## Task 01.4: Format, validate, and record evidence

**Files:**

- Verify: all increment footprint files

- [x] **Step 1:** Check formatting of the four edited integration files.

  ```bash
  vp fmt packages/_integration/__tests__/extraction.test.ts packages/_integration/__tests__/run-pipeline.ts packages/_integration/fixtures/components/transforms.tsx packages/_integration/CLAUDE.md --check
  ```

  Expected: exit 0. If it fails, run the same command without `--check`, then
  rerun the check.

- [x] **Step 2:** Validate the OODA change and registry.

  ```bash
  openspec validate harden-embedded-transform-integration --strict --no-interactive
  node openspec/schemas/ooda/scripts/registry-lint.mjs openspec/changes/harden-embedded-transform-integration
  ```

  Expected: both commands exit 0.

- [x] **Step 3:** Run `repowise distill vp run verify:integration` once more
  after formatting if formatting changed any source; otherwise retain the
  fresh Task 01.3 result.

- [x] **Step 4:** Run every guardrail in the gate below and return the focused
  RED/GREEN/full-suite evidence to the orchestrator. Do not tick shared OODA
  artifacts yourself.

## Task 01.5: Resolve the canonical Purpose review finding

**Files:**

- Modify: `openspec/specs/pipeline-integration-testing/spec.md`
- Verify: the OODA change and canonical capability

- [x] **Step 1:** Replace only the canonical Purpose's production-path clause
  with `analyzeProject()` performing embedded transform evaluation followed by
  `applyUnitFallback()`; preserve its fixture and manifest invariants.

- [x] **Step 2:** Run G5, strict OpenSpec validation, and registry lint, then
  return the resulting tree to the same independent reviewer.

## Guardrail gate

- [x] G1: `shasum -a 256 packages/extract/src/theme_resolver.rs packages/extract/crates/extract-v2/src/theme.rs` — result: pass; both outputs exactly matched the calibrated hashes.
- [x] G2: `! rg -n "resolveTransformPlaceholders" packages/vite-plugin/src packages/next-plugin/src` — result: pass; exit 0 and empty output.
- [x] G3: `! rg -n "if \\(rawCss\\.includes\\('__TRANSFORM__'\\)\\)" packages/_integration/__tests__/extraction.test.ts` — result: pass; exit 0 and empty output.
- [x] G4: `! rg -n "resolveTransformPlaceholders" packages/_integration/__tests__/run-pipeline.ts` — result: pass; exit 0 and empty output.
- [x] G5: `! sed -n '/^## Purpose$/,/^## Requirements$/p' openspec/specs/pipeline-integration-testing/spec.md | rg -n 'resolveTransformPlaceholders'` — result: pass; exit 0 and empty output. The check remains valid if the Purpose wraps across lines. Strict change and canonical-spec validation passed; registry lint remained clean.

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion.
- [x] Confirmed `Authors: —`; no additional requirement draft is owed.
- [x] Guardrail gate results recorded above, with command output excerpts.
- [x] Proposed journal entries: none. RED/GREEN matched the planned outcome,
  so neither is a `surprise`, `friction`, or `signal` entry.
- [x] Surfaced variables (spawn candidates): none.
- [x] Returned exact changed-file list and RED/GREEN/full-suite/validation
  evidence to the orchestrator: focused RED 26/27, focused GREEN 27/27, full
  integration 157/157 across 11 files, strict OpenSpec valid, registry lint
  clean, focused format clean, and `git diff --check` clean.

## Spec authorship checklist (orchestrator)

- [x] Confirmed the envelope-authored
  §pipeline-integration-testing/Full pipeline end-to-end test remains complete
  and leakage-clean.
- [x] Corrected the canonical capability Purpose and confirmed it agrees with
  the modified requirement after OpenSpec's requirement-only merge behavior
  was identified during review.
- [x] Confirmed no deferred Decision Ledger row was resolved or promoted.
- [x] Appended accepted journal entries, attributed `via inc 01 subagent` when
  applicable.
- [x] Wrote the increment reorientation entry with the full three-stance pass
  required after the envelope and by K=1.
- [x] Ticked the increment registry row with its journal reorientation
  timestamp.
