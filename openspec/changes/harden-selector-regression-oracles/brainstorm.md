# Selector regression oracle exploration

This capture is based on the live RepoWise context/risk/health/why audit, the 13/13 focused selector-rules test run, the canonical pipeline-integration and deterministic-extraction specifications, the archived `fix-selector-rule-extraction` and `extract-quirk-shed` changes, and the committed v2 parity baseline. Exploration therefore already exists; no new interactive brainstorming pass is needed.

## Known now

- RepoWise's "high-churn file with no governing decision" finding is a false positive. The selector fixture matrix is governed by the canonical `pipeline-integration-testing` specification and the archived `fix-selector-rule-extraction` decision record.
- The test and `createElement` fixture still describe two regressions as currently broken even though their active acceptance tests pass.
- The v1 integration path intentionally retains a raw unresolved alias in emitted CSS. The test describes that behavior but only proves the surrounding selector survives, so the compatibility oracle is incomplete.
- V2 intentionally diverges: it drops the unresolved declaration and emits a diagnostic. The parity baseline and archived `extract-quirk-shed` increment license that divergence.
- This increment needs no production extractor change. It can improve truthfulness with comments, one stronger v1 assertion, and a lifecycle clarification in the governing specification.

## Deferred

- **DEF-1 — Change v1 unresolved-alias behavior:** deferred until a retirement plan or explicit compatibility decision authorizes changing the v1 oracle.
- **DEF-2 — Broader selector fixture restructuring:** deferred until measured duplication or repeated maintenance failures show a concrete readability or defect-cost problem; RepoWise's current structural clone has zero co-change and is not sufficient.
- **DEF-3 — RepoWise decision indexing/tuning:** deferred until RepoWise can ingest canonical and archived OpenSpec governance or its Attention Needed finding can be annotated externally.
- **DEF-4 — Additional selector behavior coverage:** deferred until a defect, uncovered production branch, or coverage report identifies a specific missing behavior.

## Candidate north stars

- Test prose, assertions, and current engine behavior tell the same story.
- Engine-local compatibility oracles remain explicit: v1 behavior is characterized without weakening v2's intentional correctness divergence.
- Historical regressions remain active guards after they are fixed; "broken" lifecycle scaffolding does not linger in current-state documentation.
- Every change stays within the smallest source-owned verification surface.

## Candidate guardrails

- The change SHALL NOT modify production extraction behavior. Check: source diff is limited to the selector test, its fixtures, canonical/delta specs, and OODA artifacts.
- The change SHALL NOT make v1 and v2 share an oracle for unresolved aliases. Check: the focused v1 test asserts raw passthrough while the existing v2 parity baseline still records declaration drop plus warning.
- The change SHALL NOT leave current-state claims that `createElement(bareIdent)` or pass-through `outlineColor` is broken. Check: `rg` for the stale phrases in the selector test and fixtures returns no matches.
- The change SHALL NOT weaken the selector fixture matrix. Check: the focused selector suite remains 13/13 and `vp run verify:integration` passes.
- The change SHALL NOT create an OpenSpec requirement-header collision. Check: strict change validation plus the repository OpenSpec registry lint pass.

## Decision chain

1. Verify the analyzer lead against live code, tests, history, and repository decisions.
2. Reject the proposed "add a decision" response because governance already exists and the churn sample is only three commits.
3. Inspect discrepancies between prose and executable behavior; identify stale bug-state comments and the assertion gap.
4. Check both engines before strengthening the oracle; confirm v1 raw passthrough and v2 drop-and-warn are intentionally different.
5. Select a documentation-and-test hardening increment with no extractor behavior change.
6. Defer v1 behavior changes, structural refactors, and analyzer tuning until their explicit resolving signals occur.
