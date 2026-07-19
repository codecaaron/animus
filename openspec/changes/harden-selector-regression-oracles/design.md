## Context

RepoWise flagged `packages/_integration/__tests__/selector-rules.test.ts` as a high-churn file without a governing decision. Live inspection disproves both implications: the file has only three commits, and its matrix is governed by the canonical pipeline-integration specification plus the archived `fix-selector-rule-extraction` change. The actionable problem is narrower. Current comments still call two passing regressions broken, and the v1 unresolved-alias characterization does not assert the raw compatibility behavior it describes. V2 intentionally drops that declaration and warns.

The stakeholders are extractor maintainers and reviewers who use integration and parity fixtures as engine-local behavioral oracles. The repository is already dirty with unrelated verified increments, so this change must remain narrowly attributable and must not use mutative git operations.

## Goals / Non-Goals

**Goals:**

- Make current selector regression prose agree with passing behavior.
- Make the v1 unresolved-alias compatibility oracle explicit.
- Preserve the licensed v2 drop-and-warn divergence.
- Clarify the governing fixture-matrix requirement's broken-to-fixed lifecycle.

**Non-Goals:**

- Changing v1 or v2 production extraction behavior.
- Sharing implementation or expectations between the engines.
- Restructuring the selector fixture matrix.
- Tuning RepoWise or expanding selector coverage beyond the observed assertion gap.

## Decisions

### D1: Treat the RepoWise queue entry as a false positive

- **Choice**: Do not add a new governing decision or refactor the file merely because it was flagged.
- **Rationale**: Canonical and archived OpenSpec evidence already governs the matrix, the suite passes 13/13, and three commits do not substantiate a stabilization refactor.
- **Alternatives considered**: Add redundant governance; split the test file; ignore all findings. The first duplicates authority, the second has no measured benefit, and the third would leave verified truthfulness gaps.

### D2: Preserve fixed regressions as active guards

- **Choice**: Replace current-bug wording with historical regression wording while leaving the passing acceptance tests active.
- **Rationale**: Tests should state current truth without erasing why the coverage exists.
- **Alternatives considered**: Delete the tests after the fixes; retain stale prose as history. Deletion loses regression coverage, while stale prose misleads maintainers about live behavior.

### D3: Strengthen only the v1 compatibility oracle

- **Choice**: Assert that the v1 pipeline emits `outline: 2px solid {colors.does-not-exist.999}` and document that v2 intentionally drops the declaration and warns.
- **Rationale**: The current test claims raw passthrough is intentional but proves only that the surrounding rule survives. The engine-local assertion closes that gap without treating v1 behavior as the cross-engine ideal.
- **Alternatives considered**: Change v1 to match v2; change v2 to match v1; assert a common result. All three violate the licensed compatibility divergence or expand into production behavior work.

### D4: Clarify the fixture-matrix lifecycle in the governing requirement

- **Choice**: Modify the existing selector fixture-matrix requirement so seals and skipped acceptance tests are explicitly temporary while a regression is live, and fixed cases remain active guards with current-state prose.
- **Rationale**: The canonical requirement still describes the broken-state scaffolding but does not state its transition after repair.
- **Alternatives considered**: Make only implementation comments; create a new capability. The former leaves governance stale, and the latter fragments an existing requirement.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Test prose, assertions, and current engine behavior remain mutually consistent — revisit if an extractor compatibility policy replaces executable fixture behavior as the oracle.
- **NS2**: Engine-local compatibility evidence remains explicit rather than forcing shared expectations — provisional; revisit when `external:v1-extractor-retirement` occurs.
- **NS3**: Fixed regressions remain active, legible guards — revisit if measured maintenance cost shows the fixture matrix itself is the defect source.
- **NS4**: Each queue response uses the smallest source-owned verification surface — revisit if the repository verification change map changes.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Change v1 unresolved-alias behavior | deferred | external:v1-extractor-retirement | external:v1-extractor-retirement | 3 reorientations \| 2026-10-19 |
| DEF-2 | Restructure the selector fixture matrix | deferred | external:selector-fixture-maintenance-signal | external:selector-fixture-maintenance-signal | 3 reorientations \| 2026-10-19 |
| DEF-3 | Tune RepoWise decision indexing | deferred | external:repowise-openspec-indexing | external:repowise-openspec-indexing | 3 reorientations \| 2026-10-19 |
| DEF-4 | Add broader selector behavior coverage | deferred | external:selector-coverage-gap | external:selector-coverage-gap | 3 reorientations \| 2026-10-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter the committed v2 drop-and-warn oracle for the unresolved selector alias; blind spot: this checks the exact known baseline diagnostic only. | all | STOP | active (calibrated 2026-07-19: one match) |
| G2 | The selector regression suite SHALL NOT lose coverage or behavior; blind spot: the focused suite does not prove unrelated integration paths. | all | STOP | active (calibrated 2026-07-19: 13/13 passed) |
| G3 | Current-state prose SHALL NOT describe fixed selector regressions as broken or claim v2 drops the whole unresolved-alias rule; blind spot: the check covers the target test and two directly related fixtures only. | footprint:packages/_integration/** | STOP | active (final 2026-07-19: exit 1, empty output) |
| G4 | The v1 unresolved-alias characterization SHALL NOT remain weaker than its stated compatibility behavior; blind spot: exact-string matching does not validate every declaration in the rule. | footprint:packages/_integration/** | STOP | active (final 2026-07-19: one assertion match) |
| G5 | The increment SHALL NOT declare production extractor files in its footprint; blind spot: this parses declared packet footprints, while final diff review checks undeclared writes and attribution. | all | STOP | active (final 2026-07-19: exit 1, empty output) |

Checks — verbatim commands:

**G1** — expected: one matching v2 diagnostic

```bash
rg -n -F "selector-rules-unresolvable-token.tsx|warn|PatternF|unresolvable token alias {colors.does-not-exist.999} in 'outline' — declaration dropped" packages/_parity/baselines/v2/production.json
```

**G2** — expected: 1 file and 13 tests passed

```bash
repowise distill bunx vp test run packages/_integration/__tests__/selector-rules.test.ts
```

**G3** — expected after increment 01: exit 1 with empty output

```bash
rg -n 'Confirmed-on-current-code bugs|currently FAIL|does NOT recognize|does NOT resolve|Hypothesis|:focus-visible rule drops' packages/_integration/__tests__/selector-rules.test.ts packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx
```

**G4** — expected after increment 01: one matching assertion

```bash
rg -n -F 'outline: 2px solid {colors.does-not-exist.999}' packages/_integration/__tests__/selector-rules.test.ts
```

**G5** — expected after increment 01: exit 1 with empty output

```bash
sed -n '/^- \*\*Footprint\*\*:/,/^- \*\*Pushes to/p' openspec/changes/harden-selector-regression-oracles/increments/*.md | rg -n 'packages/extract/(src|crates)/'
```

## Risks / Trade-offs

[Risk] A v1 compatibility assertion could be misread as a desired cross-engine invariant -> Mitigation: name v1 in the test and explicitly point to v2's licensed drop-and-warn behavior.

[Risk] The canonical requirement could collide with another active delta -> Mitigation: search active requirement headers before authoring and run strict registry validation.

[Trade-off] Exact raw-CSS text is more coupled than a structural selector assertion -> acceptable because the precise raw leak is the compatibility behavior being characterized.

[Trade-off] Comment-only cleanup has no independent failing test -> acceptable because the behavioral assertion is mutation-tested, and stale prose is guarded with an executable zero-match check.

## Migration Plan

N/A — no deployment change. Apply the test, fixture prose, and specification update together; accept only after mutation sensitivity, focused tests, full integration, strict OpenSpec validation, and independent review pass. Rollback is the independently attributable increment, without touching unrelated dirty worktree changes.
