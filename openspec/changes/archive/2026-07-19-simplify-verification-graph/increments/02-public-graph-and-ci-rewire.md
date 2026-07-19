# Increment 02: Public graph and CI rewire

## Scope

- **Registry row**: 02 · mode: delegate · review: subagent
- **Resolves**: D2, D4, D5
- **Authors**: — (envelope)
- **Depends on**: increment 01
- **Inputs from**: none
- **Footprint**: `vite.config.ts`, `.github/workflows/ci.yaml`, `AGENTS.md`, `CLAUDE.md`, `scripts/verify/owner-graph.test.ts`, `scripts/verify/ci-graph.test.ts`
- **Pushes to a later increment**: deletion/reference cleanup remains in increment 03

> Envelope-licensed: D2, D4, and D5 are settled; ordering dependency 01 does not block packet authoring.

## Context Capsule

- **Objective**: Make root `verify` the fast gate and `verify:full` the only
  complete local/current-host claim. Select all consumer owners through Vite+
  workspace filters, remove the misleading `verify:ci` projection, and make CI
  invoke package-owned claims without changing job topology, artifacts, or
  release dependencies.
- **Required Vite+ semantics (calibrated 2026-07-18)**:
  - Root config task `verify` can coexist with package manifest scripts named
    `verify`.
  - `vp run --fail-if-no-match -F './e2e/*' -F '!animus-packed-app' -F './packages/showcase' verify` executes selected
    owners; the mandatory owner-discovery test catches a selected package that
    silently lacks the script.
  - `vp run --fail-if-no-match -F '...@animus-ui/vite-plugin' verify` selects dependent packages
    from workspace edges; do not replace this with a hard-coded consumer list.
  - `--filter` and `--recursive` are mutually exclusive.
- **Existing graph**: locate `verify`, `_verify:full:*`, `_verify:ci:*`,
  `verify:full`, and `verify:ci` under `vite.config.ts` `run.tasks`. The current
  full graph repeats root leaves and target-specific composites. CI separately
  downloads native artifacts and runs `build:ts`; consumer jobs must not
  rebuild Rust.
- **Target graph**:
  - Root `verify` remains source/current-host fast proof and includes the
    global `verify:workers:contracts` once.
  - Root `verify:full` sequentially materializes v1 NAPI, v2 NAPI, and TS dists,
    runs root `verify`, runs filtered package-owner `verify` claims, then root
    parity, integration, Rust dependency hygiene, and packed proof. Preserve
    explicit ordering without private before/after task families.
  - Delete `verify:ci` and `_verify:ci:*`. Historical OpenSpec artifacts are
    out of scope.
  - CI keeps existing jobs, artifact download/upload, and `release.needs`.
    Replace root target aliases with package-owned commands. Existing
    build+assert receipt lanes use owner phase diagnostics so they do not gain
    a new dry-run; the all-Worker job runs the global Worker contracts once plus
    filtered complete owner claims.
- **In-scope guardrails**:
  - G1: proof categories remain reachable — run the `proof-inventory=present`
    loop from `design.md` and the owner graph inventory test — STOP.
  - G3: owner claims plus root fast graph cover owner and global Worker phases
    — `bunx vp test run scripts/verify/owner-graph.test.ts -t 'consumer owner claims are complete'` — STOP.
  - G4: current executable/docs SHALL not expose local CI simulation —
    `rg -n 'verify:ci' vite.config.ts AGENTS.md CLAUDE.md` — STOP.
  - G5: packed and immutable release wiring remain intact — `bunx vp test run scripts/verify/packed-graph.test.ts scripts/verify/ci-graph.test.ts` — STOP.
- **Requirements**: change-level modified requirements `Composite
  Orchestrators`, `Change-Type Map`, `Root AGENTS.md Verification Interface`,
  `Orchestrator Binding via Vite+ vp run`, `Packed Tier Composite Membership`,
  and removed `verify:ci CI-Simulation Semantics`.
- **Resolved decisions**: D2 filtered owner claims; D4 retire false CI mirror;
  D5 CI owns environment topology.
- **Upstream inputs**: none; increment 01 is an ordering dependency and its
  expected package scripts are fully named above.
- **North Star**: NS1 select claims; NS3 workspace dependencies select scope;
  NS4 green commands state evidence/exclusions.
- **Prohibitions**: no version-control commands; no writes outside footprint or
  packet; do not edit change artifacts; do not alter release bundle commands,
  job names, `needs`, runner matrices, receipt paths, or deployment identities;
  do not make owner claims rebuild Rust prerequisites.

## Plan

## Task 02.1: Lock the smaller public graph in tests

- [x] **Step 1 (RED):** Extend `owner-graph.test.ts` with behavior/structure
  assertions that root `verify` contains the fast leaves and exactly one Worker
  contract root, while `verify:full` materializes shared artifacts, invokes
  root `verify`, selects owner `verify` scripts with fail-closed directory
  filters, and
  reaches parity/integration/hygiene/packed proof. Assert it does not enumerate
  consumer package names or target-phase aliases. Run the focused test and
  capture the expected failure.
- [x] **Step 2 (RED):** Add current-surface assertions that `verify:ci` and its
  private stages are absent. Create `scripts/verify/ci-graph.test.ts` using
  `Bun.YAML.parse` to assert package-owned CI invocation while preserving job
  names, receipt artifacts, and release dependencies. Add semantic invariants
  for release-bundle materialization → supplied-tarball verification → exact
  tarball publication order. Avoid a raw workflow-source snapshot.

## Task 02.2: Rebuild root composites around claims

- [x] **Step 1 (GREEN):** In `vite.config.ts`, keep root `verify` fast and
  global. Replace private full stages with one explicit sequential
  `verify:full` command: materialize both NAPI engines and TS dists once, run
  workspace-root `verify`, run the fail-closed directory filters for owner `verify`,
  then parity/integration/hygiene/packed diagnostics. Do not use `-r` together
  with filters.
- [x] **Step 2 (GREEN):** Remove `verify:ci` and `_verify:ci:*`. Leave old
  target aliases temporarily so CI/nightly migration can be reviewed before
  deletion in increment 03.
- [x] **Step 3:** Run the focused owner-graph tests plus task discovery checks
  proving the exact filter syntax is accepted without executing full
  production builds.

## Task 02.3: Rewire CI and contributor routing

- [x] **Step 1:** Replace CI consumer commands with package-owned commands.
  Keep build+assert-only receipt lanes on `@owner#verify:build` followed by
  `@owner#verify:assert`; use filtered complete owner claims only in the
  all-Worker job. Preserve all artifact download/build-TS preparation, job
  boundaries, receipt uploads, Worker contracts exactly once, and
  `release.needs`.
- [x] **Step 2:** Rewrite the ordinary-workflow section and Change-Type Map in
  `AGENTS.md`; present root fast, root full, owner target, and dependent-filter
  workflows first, with atomic diagnostics separated. Preserve every
  source-owned diagnostic in the Change-Type Map: for example Vite-plugin
  changes still run compile+integration before dependent claims. Every filter
  uses `--fail-if-no-match`. Update `CLAUDE.md` to
  point to the authoritative root interface and remove the local-CI claim.
- [x] **Step 3:** Run YAML parsing, owner-graph contracts, G1/G3/G4/G5, strict
  OpenSpec validation, and `git diff --check` (read-only validation; no git
  mutation). Report exact outcomes.

## Guardrail gate

- [x] G1: proof-inventory loop from `design.md` plus owner inventory test — result: exit 0; `proof-inventory=present`, owner completeness 1/1
- [x] G3: `bunx vp test run scripts/verify/owner-graph.test.ts -t 'consumer owner claims are complete'` — result: exit 0; 1/1
- [x] G4: `rg -n 'verify:ci' vite.config.ts AGENTS.md CLAUDE.md` — result: expected exit 1; no current references
- [x] G5: `bunx vp test run scripts/verify/packed-graph.test.ts scripts/verify/ci-graph.test.ts` — result: exit 0; 8/8

## Output contract

- [x] Plan checkboxes reflect actual completion and RED/GREEN evidence
- [x] CI topology/artifact/release invariants reported from parsed structure
- [x] Guardrail results include exit codes and output excerpts
- [x] Proposed journal entries supplied; surfaced variables listed or `none`
- [x] Diff stays inside footprint and preserves dirty hardening edits

## Spec authorship checklist

- [x] Envelope requirements remain sufficient; no new change-spec text required
- [x] No Decision Ledger row changes required
- [x] Orchestrator appends accepted journal entries and reorientation
- [x] Orchestrator ticks registry row with the journal timestamp
