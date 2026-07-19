# Increment 01: Harden selector regression oracles

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1,D2,D3,D4 (decided-now constraints)
- **Authors**: — (the envelope already contains the complete modified requirement)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/_integration/__tests__/selector-rules.test.ts`, `packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx`, and `packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx`
- **Pushes to a later increment**: none; DEF-1 through DEF-4 remain externally gated

> Resolving signal that licensed creating this increment now: envelope license — D1 through D4 are decided now and the row resolves no deferred Ledger decision.

## Context Capsule

- **Objective**: Make the selector integration surface state current truth. Replace stale wording that calls two passing regressions broken, explicitly assert v1's raw unresolved-alias passthrough, and make the v2 drop-and-warn divergence visible in prose without changing either engine. The focused suite currently passes 13/13.
- **In-scope guardrails**:
  - **G1**: The change SHALL NOT alter the committed v2 drop-and-warn oracle for the unresolved selector alias; exact known diagnostic only. STOP. Check:

    ```bash
    rg -n -F "selector-rules-unresolvable-token.tsx|warn|PatternF|unresolvable token alias {colors.does-not-exist.999} in 'outline' — declaration dropped" packages/_parity/baselines/v2/production.json
    ```

  - **G2**: The selector regression suite SHALL NOT lose coverage or behavior. STOP. Check:

    ```bash
    repowise distill bunx vp test run packages/_integration/__tests__/selector-rules.test.ts
    ```

  - **G3**: Current-state prose SHALL NOT describe the fixed `createElement` or pass-through alias regressions as broken in the target test or fixture. STOP. Check:

    ```bash
    rg -n 'Confirmed-on-current-code bugs|currently FAIL|does NOT recognize|does NOT resolve|Hypothesis|:focus-visible rule drops' packages/_integration/__tests__/selector-rules.test.ts packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx
    ```

  - **G4**: The v1 unresolved-alias characterization SHALL NOT remain weaker than its stated compatibility behavior. STOP. Check:

    ```bash
    rg -n -F 'outline: 2px solid {colors.does-not-exist.999}' packages/_integration/__tests__/selector-rules.test.ts
    ```

  - **G5**: The increment SHALL NOT declare production extractor files in its footprint. STOP. Check:

    ```bash
    sed -n '/^- \*\*Footprint\*\*:/,/^- \*\*Pushes to/p' openspec/changes/harden-selector-regression-oracles/increments/*.md | rg -n 'packages/extract/(src|crates)/'
    ```

- **Requirements to draft**: none. The orchestrator already authored the black-box-verifiable modified `§pipeline-integration-testing/Selector-rule fixture matrix registered` requirement.
- **Existing spec context**: Read `openspec/changes/harden-selector-regression-oracles/specs/pipeline-integration-testing/spec.md`, requirement `Selector-rule fixture matrix registered`. Fixed cases remain active guards; unresolved-alias observations stay engine-local.
- **Relevant resolved decisions**:
  - D1: Treat the RepoWise queue entry as a false positive; do not add redundant governance or restructure the test.
  - D2: Preserve fixed regressions as active guards and update their prose.
  - D3: Strengthen only the v1 compatibility oracle; v2 continues to drop the declaration and warn.
  - D4: The envelope owns the fixture-matrix lifecycle requirement.
- **Upstream inputs**: none.
- **In-scope North Star criteria**: NS1 prose/assertions/behavior agree; NS2 engine-local evidence stays explicit; NS3 fixed regressions stay active and legible; NS4 use the smallest source-owned verification surface.
- **Prohibitions**: Do not run any mutative git command. Do not write outside the declared footprint plus this increment file. Do not write `design.md`, `tasks.md`, `journal.md`, or `specs/`; return proposed shared-artifact edits in the output contract. Preserve all unrelated dirty worktree changes. Treat logical checkpoints as non-VCS checkpoints.

## Plan

## Task 01.1: Establish the current oracle

- [x] **Step 1:** Run `repowise distill bunx vp test run packages/_integration/__tests__/selector-rules.test.ts`; record the 13/13 baseline.
- [x] **Step 2:** Run the G3 stale-prose search and confirm the known five matches before editing.
- [x] **Step 3:** Read the target test header, the Bug 1 section, the unresolved-alias characterization, and the `selector-rules-create-element.tsx` comment; do not refactor neighboring tests.

## Task 01.2: Make regression history truthful

- [x] **Step 1:** In `packages/_integration/__tests__/selector-rules.test.ts`, replace the `Confirmed-on-current-code bugs` block with concise historical regression context stating that both cases are fixed and remain active guards.
- [x] **Step 2:** Rename the `Patterns that currently FAIL` section comment to a fixed-regression acceptance-guard heading; retain both active tests and their assertions.
- [x] **Step 3:** In `packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx`, replace the stale hypothesis/current-failure comment with historical regression context stating that bare-identifier `createElement` usage is now recognized and guarded by the integration test.

## Task 01.3: Strengthen the v1 compatibility characterization

- [x] **Step 1:** Rename the unresolved-alias describe/test prose to identify it as a v1 compatibility oracle.
- [x] **Step 2:** Retain the selector-survival assertion and add `expect(css).toContain('outline: 2px solid {colors.does-not-exist.999}');`.
- [x] **Step 3:** State next to the test that v1 preserves raw unresolved text while v2 intentionally drops the declaration and warns; point to parity behavior without changing parity files.

## Task 01.4: Prove assertion sensitivity and restore the fixture

- [x] **Step 1:** With `apply_patch`, temporarily change only `{colors.does-not-exist.999}` to `{colors.does-not-exist.998}` in `selector-rules-unresolvable-token.tsx`.
- [x] **Step 2:** Run the focused suite and record the expected RED failure at the new v1 raw-token assertion.
- [x] **Step 3:** With `apply_patch`, restore the fixture to `{colors.does-not-exist.999}`; verify `rg -n -F '{colors.does-not-exist.998}' packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx` exits 1 with empty output.
- [x] **Step 4:** Re-run the focused suite and record 13/13 GREEN.

## Task 01.5: Verify the increment

- [x] **Step 1:** Run `bunx oxfmt --check packages/_integration/__tests__/selector-rules.test.ts packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx`.
- [x] **Step 2:** Run `repowise distill vp run verify:integration` as required by the repository change map.
- [x] **Step 3:** Run every guardrail command below and record its exact outcome.
- [x] **Step 4:** Inspect `git diff --` limited to the three footprint files and confirm the final scoped diff contains only those three declared files and no unrelated edits. This is read-only; do not run any mutative git command.

> Formatting evidence: the prescribed `bunx oxfmt --check` command exited 1
> because the installed Vite+ `oxfmt` shim is LSP/stdin-only. The
> repository-authoritative targeted replacement, `vp fmt <three paths>
> --check`, found one formatting issue; targeted `--write` exited 0 and the
> final targeted check exited 0.

## Task 01.6: Repair independent review blockers

- [x] **Step 1:** Correct the unresolved-token fixture prose so v1 raw preservation and v2 declaration-only drop-and-warn behavior remain engine-local and explicit.
- [x] **Step 2:** Extend copied G3 to cover the unresolved-token fixture and the exact stale whole-rule-drop phrase.
- [x] **Step 3:** Replace copied G5 with a parser for the packet's actual `**Footprint**` block.
- [x] **Step 4:** Re-run targeted formatting, affected guardrails, focused and full integration, strict validation, registry lint, and diff checks.

> Review-repair evidence: targeted format check exited 0; G3 and G5 each
> exited 1 with empty output; the focused suite passed 13/13 and full
> integration passed 157/157; strict validation, registry lint, and diff check
> each exited 0.

> RF-3 repair evidence: the read-only scoped diff listed exactly the selector
> test, create-element fixture, and unresolved-token fixture declared by the
> increment footprint.

## Guardrail gate

- [x] G1: exact v2 diagnostic search — result: exit 0; exact diagnostic remains at `production.json:572`.
- [x] G2: focused selector suite — result: exit 0; 1 file and 13/13 tests passed.
- [x] G3: stale-prose search — result: exit 1 with empty output.
- [x] G4: explicit v1 raw-token assertion search — result: exit 0; assertion found at `selector-rules.test.ts:131`.
- [x] G5: production-extractor footprint search — result: exit 1 with empty output.

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Authors is envelope-owned; no additional requirement text is owed
- [x] Guardrail gate results recorded above, with command output excerpts
- [x] Proposed journal entries supplied, 1-3 lines each
  - **Signal:** The fixed `createElement` and pass-through-alias regressions remain active guards, while the v1 oracle now asserts the exact raw unresolved token that v2 intentionally drops with a warning.
  - **Friction:** The packet's direct `bunx oxfmt` command resolves to an LSP-only Vite+ shim; repository-authoritative formatting is `vp fmt`.
- [x] Surfaced variables: none
- [x] Final source diff summary and verification results supplied to the orchestrator

## Spec authorship checklist (orchestrator)

- [x] Confirmed the envelope-authored `§pipeline-integration-testing/Selector-rule fixture matrix registered` requirement remains complete and leakage-clean
- [x] Confirmed no Decision Ledger row was resolved without its external signal
- [x] Appended accepted journal entries attributed to the increment subagent
- [x] Wrote the full-cadence reorientation entry
- [x] Ticked registry row 01 with its journal evidence pointer

> Independent review: RF-1 through RF-3 were accepted and repaired; RF-4 was
> rejected as incompatible with the explicitly engine-local v1 oracle and
> DEF-1 gate. The same reviewer returned APPROVED after the final narrow pass.
