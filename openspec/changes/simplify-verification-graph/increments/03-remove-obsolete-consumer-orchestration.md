# Increment 03: Remove obsolete consumer orchestration

## Scope

- **Registry row**: 03 · mode: delegate · review: subagent
- **Resolves**: D3
- **Authors**: — (envelope)
- **Depends on**: increment 02
- **Inputs from**: none
- **Footprint**: `vite.config.ts`, `.github/workflows/ci.yaml`, `scripts/deploy/workers-nightly.sh`, `scripts/assert-showcase-build.ts`, `scripts/hygiene/{CLAUDE.md,presenter.ts}`, `scripts/verify/build-*.sh`, `scripts/verify/assert-*.sh`, `scripts/verify/owner-graph.test.ts`, `scripts/verify/workers-config.test.ts`, `packages/{showcase,vite-plugin}/CLAUDE.md`, `packages/showcase/vite.config.ts`, `e2e/{next-app,vite-app,vinext-app,react-router-app}/**/*.{ts,md}`, `AGENTS.md`, `CLAUDE.md`
- **Pushes to a later increment**: none

> Envelope-licensed: D3 is settled; the ordering dependency does not block packet authoring.

## Context Capsule

- **Objective**: Once package claims and all live callers use them, delete the
  obsolete root target-phase tasks, four private after-build dry-run tasks,
  five focused root composites, redundant consumer root build aliases, and ten
  one-command build/assertion wrappers. Retain only the two narrow root
  assertion compatibility aliases still named by active Vinext/React Router
  hardening specs. Rewire nightly deployment to package-owned phase diagnostics
  while preserving v1-build, v2-build, TS-build, build-all, assert-all,
  dry-run-all order.
- **Live-reference constraints**:
  - `scripts/deploy/workers-nightly.sh` currently calls root target-phase names
    in three loops; replace them with package-qualified `verify:build`,
    `verify:assert`, and `verify:dry-run` commands, not complete owner claims,
    so existing phase ordering remains unchanged.
  - `scripts/verify/workers-config.test.ts` owns the executable nightly command
    contract and failure-phase fixtures; update expected package-qualified
    commands and preserve deployment order/error aggregation.
  - Current comments/docs in showcase and Next/Vite configs mention old focused
    commands; replace them with package-qualified claims.
  - Do not rewrite `openspec/changes/archive/**`, prior retrospectives/plans, or
    the separate active `harden-verification-truth` artifacts. Its Vinext and
    React Router canary specs normatively name the two assertion aliases, so
    retain delegating compatibility tasks for exactly those names.
- **Removal candidates**: locate exact task symbols in `vite.config.ts` rather
  than deleting by line range: `verify:build:{next,showcase,vite,vinext,react-router}`,
  `verify:assert:{...}`, `verify:dry-run:{showcase,vite,vinext,react-router}`,
  `_verify:dry-run:*:after-build`, `verify:{next,showcase,vite,vinext,react-router}`,
  and redundant `build:{showcase,vite,vinext,react-router}`. Retain root
  `verify:assert:{vinext,react-router}` as package-delegating compatibility
  bridges; retain all root diagnostics, package owner scripts,
  `dry-run-worker.sh`, exact packed proof, release proof, and deploy scripts.
- **In-scope guardrails**:
  - G1: proof inventory and owner graph remain green — STOP.
  - G2: direct package assertion/dry-run diagnostics remain fail-loud — STOP.
  - G4: no current executable/docs local CI mirror — STOP.
  - G5: `bunx vp test run scripts/verify/packed-graph.test.ts scripts/verify/ci-graph.test.ts` remains green — STOP.
- **Requirements**: change-level `Atomic Tier Isolation`, `Per-Package Script
  Policy`, `Binding to orchestration-architecture`, focused Vinext/React Router
  requirements, and Worker dry-run diagnostics.
- **Resolved decision**: D3 diagnostics stay explicit at their owner while
  obsolete aliases leave the primary/root interface.
- **Upstream inputs**: none; expected owner task names and target graph are
  embedded above.
- **North Star**: NS1 claims over phases; NS2 one complete owner command; NS5
  retained diagnostics remain actionable.
- **Prohibitions**: no version-control commands; no writes outside footprint or
  packet; no edits to change artifacts; no release/deployment mutation; never
  delete `dry-run-worker.sh`, `_preconditions.sh`, packed/release scripts, or
  assertion TypeScript implementations.

## Plan

## Task 03.1: Prove all live callers have migrated

- [x] **Step 1 (RED):** Extend `owner-graph.test.ts` with a reference-census
  contract covering current executable, current docs, and current config
  surfaces while excluding historical/archived and active-change artifacts.
  Assert obsolete root target-phase names and wrapper paths have no live
  callers, allowing only the two documented compatibility aliases. Run focused;
  expected FAIL on nightly/config comments and root tasks.
- [x] **Step 2 (RED):** Update `workers-config.test.ts` expectations first to
  package-qualified nightly phases, preserving the exact sequence: v1 native
  build, v2 native build, TS build, all four owner builds, all four assertions,
  all four dry-runs, then deployments. Run focused; expected FAIL against the
  old shell script.

## Task 03.2: Rewire nightly and remaining current references

- [x] **Step 1 (GREEN):** Add `vp run build:extract-v1` before the existing v2
  and TS materialization in `scripts/deploy/workers-nightly.sh`. Change the
  three verification loops to map targets to package names and invoke
  `@animus-ui/<owner>#verify:{build,assert,dry-run}`. Preserve branch/secret
  checks, shared build commands, deployment commands, aggregation, and order.
- [x] **Step 2:** Update the current showcase/Next/Vite comments and package
  guidance identified by the census to package-qualified complete claims.
  Update assertion receipt lane labels in the showcase and four framework
  assertion implementations to their package-qualified diagnostics.
  Leave historical OpenSpec plans/retrospectives untouched.
- [x] **Step 3:** Run `workers-config.test.ts`; make the narrowest implementation
  adjustments needed for the predeclared behavioral contract.

## Task 03.3: Delete obsolete aliases and wrappers

- [x] **Step 1 (GREEN):** Remove the obsolete task definitions listed in the
  capsule from `vite.config.ts`, except the two named assertion compatibility
  bridges, which delegate to their package owners. Do not alter retained proof
  tasks or `verify:full` ordering.
- [x] **Step 2 (GREEN):** Delete only
  `scripts/verify/build-{next,showcase,vite,vinext,react-router}.sh` and
  `scripts/verify/assert-{next,showcase,vite,vinext,react-router}.sh` after the
  census proves no live caller. The generic replacements and TypeScript
  assertions stay.
- [x] **Step 3:** Add a bounded graph-size assertion to
  `owner-graph.test.ts`: root task count is materially below the calibrated 57
  and no per-consumer root task family remains beyond the two compatibility
  bridges. Add a contributor-surface assertion that current guidance presents
  exactly four ordinary workflow shapes: root fast, root full, package owner,
  and fail-closed dependent filter; phase diagnostics remain secondary. Prefer
  semantic assertions over an exact source snapshot and report the root count.
- [x] **Step 4:** Run owner graph, Worker config/contracts, packed graph, G1-G5,
  strict OpenSpec validation, and `git diff --check`. Report any active
  hardening-change reference collision separately; do not silently broaden
  footprint.

## Guardrail gate

- [x] G1: proof inventory and owner-graph inventory — result: exit 0; `proof-inventory=present`, owner graph 17/17
- [x] G2: owner atomic fail-loud test — result: exit 0; focused contract passed
- [x] G4: current executable/docs reference census — result: exit 0 after wildcard/root-prose repair; no retired live guidance
- [x] G5: `bunx vp test run scripts/verify/packed-graph.test.ts scripts/verify/ci-graph.test.ts` — result: exit 0; 8/8

## Output contract

- [x] Plan checkboxes reflect completion and RED/GREEN evidence
- [x] Removed task/wrapper list and final root task count reported
- [x] Nightly command order and failure semantics reported from tests
- [x] Guardrail results include exit codes and output excerpts
- [x] Proposed journal entries supplied; surfaced variables listed or `none`
- [x] Diff stays inside footprint and preserves unrelated dirty edits

## Spec authorship checklist

- [x] Envelope requirements remain sufficient; no new change-spec text required
- [x] No Decision Ledger row changes required
- [x] Orchestrator appends accepted journal entries and reorientation
- [x] Orchestrator ticks registry row with the journal timestamp
