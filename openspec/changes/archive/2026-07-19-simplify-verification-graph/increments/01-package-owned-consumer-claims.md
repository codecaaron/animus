# Increment 01: Package-owned consumer claims

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D6
- **Authors**: — (envelope)
- **Depends on**: none
- **Inputs from**: none
- **Footprint**: `packages/showcase/package.json`, `e2e/{next-app,vite-app,vinext-app,react-router-app}/package.json`, `vite.config.ts`, `scripts/verify/_preconditions.sh`, `scripts/verify/workspace-graph.ts`, `scripts/verify/owner-graph.test.ts`, `scripts/verify/build-consumer.sh`, `scripts/verify/assert-consumer.sh`
- **Pushes to a later increment**: removal of old root aliases and wrappers remains in increment 03

> Envelope-licensed: D1 and D6 are settled in `design.md`; no deferred signal is required.

## Context Capsule

- **Objective**: Add one complete, package-owned `verify` claim to showcase and
  each framework consumer without removing the old graph yet. Worker owners
  must preflight/build, assert built output, and perform the existing safe
  Wrangler dry-run; Next must preflight/build and assert. Replace five build
  wrappers and five assertion wrappers with two parameterized helpers, while
  preserving exact fail-loud remediation. Derive dependency closure from the
  workspace manifests and aggregate clean-checkout recovery into one recipe.
- **Existing implementation**:
  - Package manifests already own `build`; Worker manifests also own
    `cf:dry-run`. None currently owns `verify`.
  - `scripts/verify/build-{next,showcase,vite,vinext,react-router}.sh` duplicate
    NAPI/package-dist checks and one filtered build command.
  - `scripts/verify/assert-{next,showcase,vite,vinext,react-router}.sh` duplicate
    output existence, `_assertions` freshness, and one assertion command.
  - `scripts/verify/dry-run-worker.sh` is already generic and validates output,
    Worker identity, and `wrangler deploy --dry-run`; reuse it.
  - The cross-consumer `verify:workers:contracts` tier remains root-owned and
    MUST NOT be called by every package claim.
- **Required owner-specific metadata**:
  - `@animus-ui/showcase`: output `packages/showcase/dist`; assertion
    `scripts/assert-showcase-build.ts`; Worker `animus`.
  - `@animus-ui/next-app`: output
    `e2e/next-app/.next`; assertion `e2e/next-app/scripts/assert-build.ts`; no
    Worker phase.
  - `@animus-ui/vite-app`: output `e2e/vite-app/dist`; assertion
    `e2e/vite-app/scripts/assert-build.ts`; Worker `animus-vite-canary`.
  - `@animus-ui/vinext-app` and `@animus-ui/react-router-app`: outputs respectively
    `e2e/vinext-app/dist` and `e2e/react-router-app/build`; package-local
    `scripts/assert-build.ts`; Workers `animus-vinext-canary` and
    `animus-react-router-canary`.
  - Dependency prerequisites are deliberately absent from this list. Traverse
    each owner's transitive `workspace:*` production dependencies instead;
    this must discover `test-ds` for Showcase, Next, and Vite as well as their
    transitive system/properties/plugin/extract dependencies.
- **In-scope guardrails**:
  - G2: atomic assertions and dry-runs SHALL fail loud without silently
    building — `bunx vp test run scripts/verify/owner-graph.test.ts -t 'atomic diagnostics fail loud without building'` — STOP.
  - G3: owner claims SHALL reach required build/assert/dry-run phases and not
    duplicate the root Worker contract suite — `bunx vp test run scripts/verify/owner-graph.test.ts -t 'consumer owner claims are complete'` — STOP.
  - G6: verification SHALL not invoke mutating cleanup — `bunx vp test run scripts/verify/owner-graph.test.ts -t 'verification claims exclude mutating cleanup'` — STOP.
- **Requirements**: change-level `verification-tier-policy` requirements
  `Package-owned consumer verification`, `Complete consumer claims`,
  `Verification proof inventory`, `Atomic Tier Isolation`, and `Per-Package
  Script Policy`.
- **Resolved decisions**: D1 owner claims; D6 executable reachability rather
  than ceremonial source checks.
- **Upstream inputs**: none.
- **North Star**: NS1 select claims, not phases; NS2 one complete command per
  owner; NS5 diagnostics stay narrow and actionable.
- **Prohibitions**: no version-control commands; no writes outside the footprint
  or this packet; do not edit `design.md`, `tasks.md`, `journal.md`, or change
  specs; do not remove old root tasks/wrappers; do not add clean, fix, deploy,
  or credentialed commands.

## Plan

## Task 01.1: Specify owner-graph behavior first

- [x] **Step 1 (RED):** Create `scripts/verify/owner-graph.test.ts`. Discover
  owner manifests from `packages/showcase` plus framework packages under
  `e2e/*`, excluding the packed fixture. Assert `verify:build`,
  `verify:assert`, and `verify`
  exist; Worker owners also expose `verify:dry-run`; Next does not. Resolve the
  command chains and assert build precedes assertion, assertion precedes
  dry-run, and no owner invokes `verify:workers:contracts`. Assert the
  manifest-derived dist closure of
  each owner includes every reachable dist-bearing `workspace:*` production
  dependency, including `test-ds` where declared. Run `bunx vp test run
  scripts/verify/owner-graph.test.ts`; expected FAIL because owner scripts and
  the workspace resolver do not exist.
- [x] **Step 2 (RED):** Add a black-box child-process case invoking the proposed
  generic assertion helper against a deliberately absent output directory.
  Assert non-zero exit, exact `vp run @animus-ui/vite-app#verify:build`
  remediation, and absent output after exit. Add a command-contract case that
  rejects `clean`, `hygiene`, `check:fix`, and `--fix` in all owner `verify`
  chains. Re-run and retain the RED evidence.

## Task 01.2: Derive workspace closure and consolidate helpers

- [x] **Step 1 (GREEN):** Create `scripts/verify/workspace-graph.ts`. Discover
  workspace manifests from the root declaration, resolve package names to
  directories, traverse only production `workspace:*` dependency edges, and
  return each transitive package whose manifest exposes a dist entry. Detect a
  missing manifest, unknown workspace edge, or cycle with a named diagnostic.
  Do not encode owner-specific dependency arrays.
- [x] **Step 2 (GREEN):** Create `scripts/verify/build-consumer.sh`. Resolve the
  repository root and caller package name, source `_preconditions.sh`, require
  fresh v1/v2 NAPI binaries, then ask `workspace-graph.ts` for the caller's
  transitive dist-bearing closure and check every result by its resolved
  workspace directory rather than reconstructing `packages/<name>`. Continue through all
  checks, report every missing/stale artifact, and finish failures with one
  ordered copy-paste preparation recipe. The helper never builds upstream
  prerequisites.
- [x] **Step 3 (GREEN):** Create `scripts/verify/assert-consumer.sh`. Accept the
  owner output path and assertion entry path, require the output directory and
  fresh `_assertions` dist, emit the package-qualified `verify:build`
  remediation, then execute the assertion entry. Update the shared dist
  precondition to derive the remediation package name from that directory's
  manifest, so `_assertions` correctly names `@animus-ui/assertions`. Validate
  both input paths independently and reject absolute or repository-escaping
  traversal. It must not invoke a build.
- [x] **Step 4:** Run the focused black-box tests until the helper behavior is
  green. Keep the existing ten wrappers untouched for compatibility until
  increment 03.

## Task 01.3: Add complete package-owned claims

- [x] **Step 1:** Add `verify:build`, `verify:assert`, and `verify` scripts to
  all five manifests using the owner data above. Add `verify:dry-run` to the
  four Worker owners by calling the existing generic dry-run helper. Complete
  scripts sequence only package-local phases and never call the global Worker
  contract tier.
- [x] **Step 2:** Calibrate nested package execution and package-target
  discovery without invoking production builds. Execute every manifest's
  complete shell chain through a controlled `vp` command double, prove exact
  ordered phase calls, and prove a failed phase blocks later phases. Keep all
  internal dispatch on the repository's canonical `vp run` path.
- [x] **Step 3:** Run all three focused guardrail tests and the full
  `owner-graph.test.ts` suite. Register that test in root `verify:unit:ts`, run
  it through the owning tier, and report exact exit codes and relevant output.

## Guardrail gate

- [x] G2: `bunx vp test run scripts/verify/owner-graph.test.ts -t 'atomic diagnostics fail loud without building'` — result: exit 0; 1 passed, 9 skipped; missing artifacts reported without executing build.
- [x] G3: `bunx vp test run scripts/verify/owner-graph.test.ts -t 'consumer owner claims are complete'` — result: exit 0; 1 passed, 9 skipped; exact phase order and short-circuit exercised through command double.
- [x] G6: `bunx vp test run scripts/verify/owner-graph.test.ts -t 'verification claims exclude mutating cleanup'` — result: exit 0; 1 passed, 9 skipped; no clean/hygiene/fix command reachable.

## Output contract

- [x] Plan checkboxes reflect actual RED/GREEN completion
- [x] Guardrail results include commands, exit codes, and output excerpts
- [x] Old aliases and wrappers remain available for increment 02/03 migration
- [x] Proposed journal entries supplied; surfaced variables: none
- [x] Diff stays inside the declared footprint and preserves pre-existing edits

## Spec authorship checklist

- [x] Envelope requirements remain sufficient; no new change-spec text required
- [x] No Decision Ledger row changes required
- [x] Orchestrator appends accepted journal entries and reorientation
- [x] Orchestrator ticks registry row with the journal timestamp
