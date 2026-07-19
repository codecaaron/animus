# Fail-Loud Canary Fixture Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `test-driven-development` to implement this packet task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Git operations are prohibited; logical checkpoints replace commits.

**Goal:** Make the real-document canary surface missing fixture paths at discovery instead of silently analyzing an empty or partial corpus.

**Architecture:** Keep the existing synchronous recursive fixture walker and its call site. Add one direct missing-root regression, prove it fails under the swallowed-error implementation, then remove only the two catch blocks so native path-bearing filesystem errors propagate.

**Tech Stack:** TypeScript, Vitest through Vite+, Node filesystem APIs, RepoWise command distillation.

---

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1,D2,D3
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/tests/canary.test.ts`
- **Pushes to a later increment**: none

> Resolving signal that licensed creating this increment now: envelope-licensed decided-now decisions D1,D2,D3; no deferred row or journal signal is required.

## Context Capsule

- **Objective**: `discoverFiles` currently catches and discards both `readdirSync` and `statSync` errors. Add a deterministic regression showing a missing configured root throws an error containing that root, then make the minimal helper change that propagates native filesystem errors. Healthy behavior must retain the exact four real-document roots, existing ignore list, four snapshots, and all existing canary assertions.
- **Source structure**: In `packages/extract/tests/canary.test.ts`, locate `function discoverFiles(dir: string, exts: Set<string>): string[]`. Immediately after it is `describe('snapshot: real doc site', ...)`, whose `sourceDirs` contain `legacy/ui/src`, `legacy/_docs/elements`, `legacy/_docs/components`, and `legacy/_docs/pages`. Do not use fixed line numbers.
- **Baseline evidence**: `repowise distill vp run verify:canary` passed 199 tests, 0 failed, 4 snapshots before this increment. RepoWise health reported the two swallowed catches and nested complexity; sync-I/O findings were dispositioned as false positives for this test harness.
- **In-scope guardrails**:
  - G1: `discoverFiles` SHALL NOT swallow a filesystem exception; blind spot: lexical check does not prove callers never catch it. STOP check:

    ```bash
    cd /Users/sugarat/agent-workspaces/me-im-counting/animus && awk '/^function discoverFiles\(/,/^}/' packages/extract/tests/canary.test.ts | rg -n 'catch'
    ```

    Expected after implementation: empty output and `rg` exit 1.
  - G2: configured real-document roots SHALL NOT change; blind spot: exact strings do not prove filesystem contents. STOP check:

    ```bash
    cd /Users/sugarat/agent-workspaces/me-im-counting/animus && rg -n "join\(ROOT, 'legacy/(ui/src|_docs/(elements|components|pages))'\)" packages/extract/tests/canary.test.ts
    ```

    Expected: exactly four lines naming the four roots above.
  - G3: existing canary assertions and four snapshots SHALL NOT be weakened. STOP check:

    ```bash
    cd /Users/sugarat/agent-workspaces/me-im-counting/animus && repowise distill vp run verify:canary
    ```

    Expected: 200 pass, 0 fail, 4 snapshots.
  - G4: implementation footprint SHALL NOT add extract-package changes beyond `canary.test.ts`; blind spot: allowlist deliberately ignores three preserved pre-existing v2 Rust diffs. STOP check:

    ```bash
    cd /Users/sugarat/agent-workspaces/me-im-counting/animus && git diff --name-only -- packages/extract | rg -v '^(packages/extract/tests/canary\.test\.ts|packages/extract/crates/extract-v2/src/(analyze_css|cross_file|pipeline)\.rs)$'
    ```

    Expected: empty output and `rg` exit 1.
- **Requirements to draft**: none; the envelope already authored `§canary-fixture-discovery/Real-document fixture discovery fails loud` and `§canary-fixture-discovery/Healthy real-document discovery remains complete`.
- **Existing spec context**: `openspec/changes/fail-loud-canary-fixture-discovery/specs/canary-fixture-discovery/spec.md` contains the complete behavioral contract. Do not edit it.
- **Relevant resolved decisions**: D1 propagate native filesystem errors; D2 use one missing-root regression; D3 retain synchronous recursive traversal.
- **Upstream inputs**: none.
- **In-scope North Star criteria**: NS1 report prerequisite failures at their originating boundary; NS2 preserve the healthy corpus oracle; NS3 remain test-harness-only and behaviorally minimal.
- **Prohibitions**: Do not run any mutative git command. Do not write outside `packages/extract/tests/canary.test.ts` and this increment file. Do not write `design.md`, `tasks.md`, `journal.md`, or `specs/`. Do not alter snapshots, configured roots, ignored-directory names, production extractor code, or any pre-existing diff. Treat logical checkpoints as non-VCS review boundaries.

## Plan

### Task 01.1: Establish the missing-root regression

- [x] **Step 1: Add the failing regression next to `discoverFiles`.** In `packages/extract/tests/canary.test.ts`, insert this test after the helper and before the real-document describe block:

  ```ts
  test('fixture discovery fails loud when a configured root is missing', () => {
    const missingRoot = join(__dirname, '__missing-canary-fixture-root__');

    expect(() => discoverFiles(missingRoot, new Set(['.tsx']))).toThrow(missingRoot);
  });
  ```

- [x] **Step 2: Run the focused regression and record RED.**

  ```bash
  cd /Users/sugarat/agent-workspaces/me-im-counting/animus && repowise distill bunx vp test run packages/extract/tests/canary.test.ts -t 'fixture discovery fails loud when a configured root is missing'
  ```

  Expected before implementation: 1 failed test; the expectation says the function did not throw. Do not weaken the assertion. If the test unexpectedly passes, stop and report the changed precondition.

### Task 01.2: Propagate filesystem failures

- [x] **Step 1: Replace only the body of `discoverFiles` with the minimal fail-loud traversal.**

  ```ts
  function discoverFiles(dir: string, exts: Set<string>): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (['node_modules', 'dist', '.next', 'target'].includes(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) results.push(...discoverFiles(full, exts));
      else if (exts.has(extname(full))) results.push(full);
    }
    return results;
  }
  ```

- [x] **Step 2: Re-run the focused regression and record GREEN.**

  ```bash
  cd /Users/sugarat/agent-workspaces/me-im-counting/animus && repowise distill bunx vp test run packages/extract/tests/canary.test.ts -t 'fixture discovery fails loud when a configured root is missing'
  ```

  Expected: the named test passes and no test fails.

- [x] **Step 3: Check formatting without rewriting.**

  ```bash
  cd /Users/sugarat/agent-workspaces/me-im-counting/animus && vp fmt --check packages/extract/tests/canary.test.ts
  ```

  Expected: exit 0. If it fails, use the repository formatter on this file only, then re-run the check; do not hand-format unrelated code.

- [x] **Step 4: Run the mapped complete canary diagnostic.**

  ```bash
  cd /Users/sugarat/agent-workspaces/me-im-counting/animus && repowise distill vp run verify:canary
  ```

  Expected: 200 pass, 0 fail, 4 snapshots.

> TDD evidence: focused RED exited 1 because the function did not throw; focused
> GREEN exited 0 with the named test passing and 199 skipped. The complete
> canary diagnostic exited 0 with 200 pass, 0 fail, and 4 snapshots.

## Guardrail gate

- [x] G1: run the Context Capsule command — result: exit 1 with empty output; no `catch` remains in `discoverFiles`.
- [x] G2: run the Context Capsule command — result: exit 0 with exactly four unchanged fixture-root lines.
- [x] G3: run the Context Capsule command — result: exit 0 with 200 pass, 0 fail, and 4 snapshots.
- [x] G4: run the Context Capsule command — result: exit 1 with empty output after the preserved-file allowlist.

## Output contract

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Authors confirmed as envelope-owned; no change-level spec draft produced
- [x] Guardrail results recorded above with concise output excerpts
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each, or `none`
  - **Signal:** The missing-root regression proved the swallowed-error helper returned silently; removing only the catches propagated the native path-bearing error while the healthy 200-test/four-snapshot canary remained intact.
- [x] Surfaced variables (spawn candidates): none
- [x] Return a concise implementation summary, RED/GREEN evidence, exact files changed, and any false positives or deviations; do not review your own work

## Spec authorship checklist (orchestrator)

- [x] Confirmed envelope requirements remain leakage-clean and cover the implementation
- [x] Confirmed no Decision Ledger row was resolved by this increment
- [x] Appended accepted journal evidence and reviewer objections with dispositions
- [x] Reorientation entry written with the full K=1 adversarial pass
- [x] Ticked registry row with the reorientation timestamp
