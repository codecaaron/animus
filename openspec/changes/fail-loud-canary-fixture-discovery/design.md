## Context

`packages/extract/tests/canary.test.ts` is the NAPI boundary canary and a high-churn, single-owner hotspot. The repository already governs its role through the root verification interface and `verification-tier-policy`; the analyzer's “no governing decision” wording is therefore false. A narrower source inspection found that the real-document fixture walker suppresses filesystem errors and can feed a partial corpus to extraction, obscuring the actual prerequisite failure. This change is constrained to one test-harness increment and must preserve the existing dirty-tree Rust work.

## Goals / Non-Goals

**Goals:**

- Make missing or unreadable real-document fixture paths fail at discovery.
- Prove the failure contract with a test that is red against the current helper.
- Preserve the current healthy corpus, snapshots, and NAPI boundary behavior.

**Non-Goals:**

- Reorganize the canary file or production extractor.
- Replace synchronous filesystem traversal.
- Deduplicate engine-local or cross-suite test oracles.
- Raise the file's history-dominated RepoWise health score in one increment.

## Decisions

### D1: Propagate fixture-discovery filesystem errors

- **Choice**: Remove the outer and per-entry catch blocks from `discoverFiles`; allow the original `readdirSync` or `statSync` error to reach the canary runner.
- **Rationale**: The corpus is a checked-in prerequisite, not optional input. Propagation preserves the failing path and prevents a partial corpus from producing a misleading extraction assertion.
- **Alternatives considered**: Return an empty list (current silent failure); log and continue (still permits partial evidence); wrap every error (adds code without improving the native path-bearing diagnostic).

### D2: Specify the behavior with one missing-root regression

- **Choice**: Add a direct test that calls `discoverFiles` with a deterministic nonexistent path and expects the filesystem error to include that path.
- **Rationale**: This is the smallest black-box witness that fails under the old behavior and proves the desired diagnostic boundary without filesystem mutation.
- **Alternatives considered**: Mock `statSync` for a per-entry race (more machinery and weaker fidelity); temporarily rename a real fixture (destructive and unsafe); rely only on downstream snapshot failures (does not distinguish silent omission).

### D3: Retain synchronous recursive traversal

- **Choice**: Keep the existing recursive, synchronous walker and ignored-directory set.
- **Rationale**: It runs once in a local test harness over a bounded checked-in corpus. RepoWise's hot-path and N+1 performance heuristics do not describe this execution context.
- **Alternatives considered**: Async traversal (larger control-flow and call-site change with no measured benefit); glob dependency (new dependency and matching semantics for four roots).

## North Star

**Adversarial cadence K**: 1

- **NS1**: A broken canary prerequisite is reported at its originating boundary before extraction or snapshot evaluation.
- **NS2**: Healthy fixture discovery remains a faithful oracle over the exact configured corpus.
- **NS3**: The change stays test-harness-only and behaviorally minimal — provisional; revisit when a measured, separately reviewed decomposition demonstrates lower co-change risk without weakening the unified NAPI claim.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Whether to split the canary into cohesive files | deferred | external:canary-structure-proposal | external:canary-structure-proposal | 3 reorientations \| 2026-08-19 |
| DEF-2 | Whether to share fixtures or assertions with integration tests | deferred | external:proven-cross-suite-contract | external:proven-cross-suite-contract | 3 reorientations \| 2026-08-19 |
| DEF-3 | Whether per-entry filesystem races need tolerant handling | deferred | external:fixture-race-reproduction | external:fixture-race-reproduction | 3 reorientations \| 2026-08-19 |
| DEF-4 | Whether to pursue a history-score-specific refactor | deferred | external:repowise-health-plan | external:repowise-health-plan | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | `discoverFiles` SHALL NOT swallow a filesystem exception; blind spot: this lexical check does not prove a caller cannot catch the propagated error. | inc:01 | STOP | armed(inc 01); calibrated 2026-07-19: 2 hits, expected 0 after increment |
| G2 | The configured real-document roots SHALL NOT change; blind spot: exact-string matching does not prove filesystem contents are unchanged. | all | STOP | active; calibrated 2026-07-19: exactly 4 expected roots |
| G3 | Existing canary assertions and four snapshots SHALL NOT be weakened; blind spot: a green suite cannot detect semantically weak new assertions. | inc:01 | STOP | armed(inc 01); calibrated 2026-07-19: 199 pass, 0 fail, 4 snapshots; expected 200 pass after increment |
| G4 | The implementation footprint SHALL NOT add extract-package changes beyond `canary.test.ts`; blind spot: the allowlist deliberately ignores three preserved pre-existing v2 Rust diffs and does not inspect OpenSpec artifacts. | inc:01 | STOP | active; calibrated 2026-07-19: empty output after allowlist |

Checks — verbatim commands:

**G1** — expected after increment: empty output and `rg` exit 1

```bash
cd /Users/sugarat/agent-workspaces/me-im-counting/animus && awk '/^function discoverFiles\(/,/^}/' packages/extract/tests/canary.test.ts | rg -n 'catch'
```

**G2** — expected: exactly four lines for `legacy/ui/src`, `legacy/_docs/elements`, `legacy/_docs/components`, and `legacy/_docs/pages`

```bash
cd /Users/sugarat/agent-workspaces/me-im-counting/animus && rg -n "join\(ROOT, 'legacy/(ui/src|_docs/(elements|components|pages))'\)" packages/extract/tests/canary.test.ts
```

**G3** — expected after increment: 200 pass, 0 fail, 4 snapshots

```bash
cd /Users/sugarat/agent-workspaces/me-im-counting/animus && repowise distill vp run verify:canary
```

**G4** — expected: empty output and `rg` exit 1

```bash
cd /Users/sugarat/agent-workspaces/me-im-counting/animus && git diff --name-only -- packages/extract | rg -v '^(packages/extract/tests/canary\.test\.ts|packages/extract/crates/extract-v2/src/(analyze_css|cross_file|pipeline)\.rs)$'
```

## Risks / Trade-offs

[Risk] A transient filesystem race now fails the canary instead of skipping one entry. -> Mitigation: the corpus is repository-local and immutable during a normal run; retain DEF-3 if platform evidence emerges.

[Risk] A broad-file edit can accidentally weaken unrelated assertions. -> Mitigation: one localized test/helper diff, complete canary execution, and independent review.

[Trade-off] The overall file remains large and history-heavy. -> Acceptable because a structural refactor is not justified by this specific failure and would enlarge the verification radius.

## Migration Plan

N/A — no deployment change. Acceptance is a recorded red/green regression, complete canary pass, guardrail pass, strict OpenSpec validation, and clean independent review. Rollback is the independent removal of the new test and helper change; no git mutation is authorized in this workspace.
