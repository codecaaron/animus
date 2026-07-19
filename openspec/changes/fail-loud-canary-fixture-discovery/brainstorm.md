# Exploration evidence

This capture is based on the live RepoWise `get_context`, `get_risk`, `get_why`, and `get_health` results for `packages/extract/tests/canary.test.ts`, a source read of `discoverFiles` and its real-document-site caller, the canonical `verification-tier-policy` spec, and a clean baseline run of `repowise distill vp run verify:canary` (199 tests passed). The analyzer lead was treated as a hypothesis, not ground truth.

## Known now

- The file is a real hotspot (99.8th percentile, bus factor 1), but it is not ungoverned: the root verification interface and `verification-tier-policy` define the NAPI canary and the repository-wide fail-loud diagnostic principle.
- `discoverFiles` is test-harness code used to assemble the archived UI/docs corpus for the `snapshot: real doc site` canary. Its configured roots are deliberate realistic fixtures.
- Both the outer `readdirSync` failure and each inner `statSync` failure are swallowed. A missing or unreadable prerequisite can therefore become an empty/partial corpus and fail later as a misleading component-count or snapshot mismatch.
- Synchronous filesystem traversal is appropriate for this one-shot test fixture. RepoWise's sync-I/O and N+1 findings are false positives here.
- Cross-suite textual duplication is largely test-oracle duplication across engine boundaries. This increment will not create a shared helper or restructure the 3,900-line canary.
- The smallest behavior-complete improvement is to let filesystem errors propagate and add a direct regression test proving a missing root fails at discovery.

## Deferred

- Splitting the canary by extraction concern is deferred until a measured edit shows a cohesive boundary that reduces co-change scatter without obscuring the single NAPI boundary claim. Resolving signal: a proposed split with an explicit test inventory and before/after RepoWise dependency/co-change evidence.
- Sharing fixtures or assertions with integration tests is deferred until repeated changes prove a semantic contract rather than superficial clone similarity. Resolving signal: at least one concrete co-change where identical behavior must be updated in both suites.
- Handling transient per-entry filesystem races differently from root failures is deferred. Resolving signal: a reproducible platform-specific failure showing propagation is too strict for the repository's checked-in, local fixture corpus.
- Improving the overall RepoWise health score is deferred because historical entropy and file size dominate it and cannot be honestly fixed by this increment. Resolving signal: a separately approved structural decomposition plan.

## Candidate north stars

- Canary prerequisite failures surface at the filesystem boundary that caused them, before extraction or snapshot assertions run.
- Healthy fixture discovery preserves the exact current corpus and all existing NAPI canary behavior.
- The increment remains test-harness-only and independently revertible.

## Candidate guardrails

- The change SHALL NOT modify production extractor code. Check: diff footprint contains only the canary test and this OpenSpec change.
- The change SHALL NOT change the configured real-document fixture roots or ignored directory names. Check: targeted diff inspection and exact-string guard.
- The change SHALL NOT weaken any existing canary assertion or snapshot. Check: `vp run verify:canary` passes with the existing four snapshots.
- The change SHALL NOT retain a swallowed catch in `discoverFiles`. Check: targeted source search for `catch` within the helper returns no match.
- The regression SHALL prove the old behavior is wrong before implementation. Check: run the focused new test against the pre-fix helper and record the expected failure.

## Decision chain

1. The queue called the whole file a high-churn, ungoverned hotspot.
2. Repository policy and OpenSpec show the canary is already governed, so a documentation-only response would duplicate authority and a broad refactor would exceed the evidence.
3. RepoWise health isolated `discoverFiles` as the only local nested-complexity hotspot and identified two swallowed catches.
4. Caller inspection showed that silent omission corrupts the realism of the downstream snapshot oracle and delays the diagnostic.
5. A direct missing-root regression can distinguish the current silent behavior from the intended fail-loud behavior without introducing filesystem mutation or touching production code.
6. Therefore the increment will remove the catches, retain the synchronous traversal, add one regression, and verify the complete canary.
