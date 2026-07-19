# Increment 01: Preserve wrapper options

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3
- **Authors**: — (the envelope already contains the complete modified
  `next-config-wrapper` requirement)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**:
  `packages/next-plugin/src/with-animus.ts`,
  `packages/next-plugin/tests/with-animus.test.ts`,
  `packages/next-plugin/README.md`
- **Pushes to a later increment**: none; any newly discovered decision-shaped
  unknown must be returned as a spawn candidate rather than resolved here

> Resolving signal that licensed creating this increment now: envelope
> licensing for decided-now decisions D1-D3; no deferred Ledger row is
> resolved by this packet.

## Context Capsule

- **Objective**: The public `withAnimus(options)(nextConfig)` wrapper currently
  reconstructs a subset of `AnimusNextOptions`, omitting `extensions` and
  `layers` before the real `AnimusWebpackPlugin` sees them. Add a focused
  public-boundary regression test, observe it fail for the omission, pass the
  original typed options object to the plugin, and correct the README's stale
  two-argument example. Do not modify plugin internals.
- **Repository constraints**: Work in
  `/Users/sugarat/agent-workspaces/me-im-counting/animus` on the existing
  `chore/refactor-town` checkout. Root `AGENTS.md` forbids every mutative Git
  operation. Preserve all pre-existing dirty Rust, integration, and completed
  OODA work. Use `bun` for package management, `vp` for task orchestration,
  and `repowise distill` for noisy tests/builds/lints. If a command returns a
  `[repowise#<ref>]` omission marker, expand that ref rather than rerunning.
- **Current source seam**: In exported function `withAnimus` in
  `packages/next-plugin/src/with-animus.ts`, locate the comment
  `// Inject AnimusWebpackPlugin`. The constructor currently copies
  `system`, `exclude`, `strict`, `verbose`, `prefix`, and `engine`; it does not
  copy `extensions` or `layers`. `AnimusWebpackPlugin#getOptions()` returns the
  options object it receives. `AnimusNextOptions` in
  `packages/next-plugin/src/types.ts` declares all eight supported fields.
- **Current documentation seam**: The setup example in
  `packages/next-plugin/README.md` currently calls
  `withAnimus(nextConfig, { system: './src/ds.ts' })`, while the implemented
  public API is curried.
- **Existing spec context**: Change-level
  `specs/next-config-wrapper/spec.md` modifies `### Requirement: withAnimus
  config wrapper`. Its `Complete options forwarded to plugin` scenario says
  any supported combination of `system`, `exclude`, `extensions`, `strict`,
  `verbose`, `prefix`, `engine`, and `layers` must be retained exactly by the
  injected plugin, including the complete extension list and layer order.
- **Relevant resolved decisions**:
  - D1: pass the original typed options object to the plugin as one unit.
  - D2: test the exported wrapper with the real plugin instance under an
    isolated temporary project root.
  - D3: correct the README example in the same contract increment.
- **Upstream inputs**: none.
- **In-scope North Star criteria**:
  - NS1: every valid typed option crosses the wrapper boundary without an
    adapter-maintained allowlist.
  - NS2: public examples, requirements, and tests describe the same curried
    API.
  - NS3: keep this high-churn area change at the narrowest behavior-owning seam.
- **In-scope guardrails**:
  - G1 — SHALL NOT modify `packages/next-plugin/src/plugin.ts` — STOP.

    ```bash
    git diff --exit-code -- packages/next-plugin/src/plugin.ts
    ```

  - G2 — SHALL NOT retain a hand-copied plugin-options allowlist — STOP.

    ```bash
    sed -n '/\/\/ Inject AnimusWebpackPlugin/,/config.plugins.push(plugin)/p' packages/next-plugin/src/with-animus.ts | rg -n 'new AnimusWebpackPlugin\(options\)'
    if sed -n '/\/\/ Inject AnimusWebpackPlugin/,/config.plugins.push(plugin)/p' packages/next-plugin/src/with-animus.ts | rg -n 'system: options\.system|exclude: options\.exclude|extensions: options\.extensions|strict: options\.strict|verbose: options\.verbose|prefix: options\.prefix|engine: options\.engine|layers: options\.layers'; then exit 1; fi
    ```

  - G3 — SHALL NOT retain the obsolete README two-argument call — STOP.

    ```bash
    if rg -n 'withAnimus\(nextConfig,' packages/next-plugin/README.md; then exit 1; fi
    ```

  - G4 — SHALL NOT alter the preserved pre-existing tracked Rust/integration
    diffs — STOP. Expected SHA-256:
    `f6f120b895f350f209739f1bda6b4e4ef8d65588063b600fb5ba2b26e271235e`.

    ```bash
    git diff -- openspec/specs/pipeline-integration-testing/spec.md packages/_integration packages/extract/crates/extract-v2/src/analyze_css.rs packages/extract/crates/extract-v2/src/cross_file.rs packages/extract/crates/extract-v2/src/pipeline.rs packages/extract/tests/canary.test.ts | shasum -a 256
    ```

  - G5 — SHALL NOT regress compile, TypeScript unit, or Next consumer owner
    claims — STOP at change end.

    ```bash
    set -e
    repowise distill vp run verify:compile
    repowise distill vp run verify:unit:ts
    repowise distill vp run @animus-ui/next-app#verify
    ```

- **Prohibitions**: no version-control commands other than read-only Git
  inspection; no writes outside the declared footprint plus this increment
  packet; never write `design.md`, `tasks.md`, `journal.md`, or `specs/`;
  return proposed journal entries to the orchestrator. Treat any commit point
  emitted by a skill as a logical checkpoint only.

## Plan

## Task 01.1: Prove the public wrapper drops valid options

- [x] **Step 1: Create the focused regression test.** Add
  `packages/next-plugin/tests/with-animus.test.ts` with the following behavior.
  It must use the exported wrapper and real plugin, isolate filesystem writes
  in a temporary root, and clean up both the spy and temporary directory.

  ```ts
  import { mkdtempSync, rmSync } from 'fs';
  import { tmpdir } from 'os';
  import { join } from 'path';
  import { afterEach, describe, expect, test, vi } from 'vitest';

  import { AnimusWebpackPlugin } from '../src/plugin';
  import type { AnimusNextOptions } from '../src/types';
  import { withAnimus } from '../src/with-animus';

  const temporaryRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe('withAnimus', () => {
    test('forwards every configured option to the injected plugin', () => {
      const root = mkdtempSync(join(tmpdir(), 'animus-next-options-'));
      temporaryRoots.push(root);
      vi.spyOn(process, 'cwd').mockReturnValue(root);

      const options: AnimusNextOptions = {
        system: './src/ds.ts',
        exclude: ['**/*.stories.tsx'],
        extensions: ['.ts', '.tsx'],
        strict: true,
        verbose: true,
        prefix: 'acme',
        engine: 'v1',
        layers: [
          'reset',
          'global',
          'base',
          'variants',
          'compounds',
          'states',
          'system',
          'custom',
          'overrides',
        ],
      };

      const wrapped = withAnimus(options)({});
      const config = wrapped.webpack?.({}, {});
      const plugin = config?.plugins?.find(
        (candidate) => candidate instanceof AnimusWebpackPlugin
      ) as AnimusWebpackPlugin | undefined;

      expect(plugin?.getOptions()).toEqual(options);
    });
  });
  ```

- [x] **Step 2: Run the focused test and record a genuine RED.**

  ```bash
  repowise distill bunx vp test run packages/next-plugin/tests/with-animus.test.ts
  ```

  Expected: one assertion failure showing the plugin options omit
  `extensions` and `layers`. An import, type, or setup error is not an accepted
  RED; correct the test setup and rerun until the behavioral assertion fails.

## Task 01.2: Forward the typed options object

- [x] **Step 1: Apply the minimal production fix.** In exported function
  `withAnimus` in `packages/next-plugin/src/with-animus.ts`, replace the entire
  hand-copied constructor object under `// Inject AnimusWebpackPlugin` with:

  ```ts
  const plugin = new AnimusWebpackPlugin(options);
  ```

  Do not change `AnimusWebpackPlugin`, `AnimusNextOptions`, loader options, or
  any other wrapper behavior.

- [x] **Step 2: Re-run the focused test and record GREEN.**

  ```bash
  repowise distill bunx vp test run packages/next-plugin/tests/with-animus.test.ts
  ```

  Expected: 1 test passes, 0 fails, with no warnings or errors.

## Task 01.3: Align the public README

- [x] **Step 1: Correct the setup example.** In
  `packages/next-plugin/README.md`, retain the existing `nextConfig` declaration
  and replace the obsolete export with:

  ```ts
  export default withAnimus({
    system: './src/ds.ts',
  })(nextConfig);
  ```

- [x] **Step 2: Run the focused formatter check.**

  ```bash
  vp fmt --check packages/next-plugin/src/with-animus.ts packages/next-plugin/tests/with-animus.test.ts packages/next-plugin/README.md
  ```

  Expected: exit 0. If the formatter does not accept Markdown targets, record
  that friction and rerun the exact check for the two TypeScript files only;
  do not mutate formatting outside the footprint.

## Task 01.4: Run repository-mapped verification

- [x] **Step 1: Run the focused test once more after all footprint edits.**

  ```bash
  repowise distill bunx vp test run packages/next-plugin/tests/with-animus.test.ts
  ```

  Expected: 1 pass, 0 fail.

- [x] **Step 2: Run the root compile claim.**

  ```bash
  repowise distill vp run verify:compile
  ```

  Expected: exit 0 for every package.

- [x] **Step 3: Run the TypeScript unit claim containing the new test.**

  ```bash
  repowise distill vp run verify:unit:ts
  ```

  Expected: exit 0 with no failed tests.

- [x] **Step 4: Run the Next consumer owner claim required for
  `packages/next-plugin/src/**`.**

  ```bash
  repowise distill vp run @animus-ui/next-app#verify
  ```

  Expected: production build and positional assertions exit 0. Expand any
  RepoWise omission ref if omitted detail is required; do not rerun merely to
  reveal distilled output.

## Guardrail gate

- [x] G1: `git diff --exit-code -- packages/next-plugin/src/plugin.ts` — result:
  exit 0 with no diff.
- [x] G2: constructor whole-object/partial-copy check from the Context Capsule — result:
  exit 0; the scoped injection block reported
  `const plugin = new AnimusWebpackPlugin(options);` and no partial-copy field.
  The original broader check stopped on the intentional loader-only
  `options: { strict: options.strict }`; after root recalibrated G2 to the
  plugin-injection block, the corrected guardrail passed.
- [x] G3: obsolete README call check from the Context Capsule — result:
  exit 0 with no match.
- [x] G4: preserved-diff SHA-256 check from the Context Capsule — result:
  exit 0 with
  `f6f120b895f350f209739f1bda6b4e4ef8d65588063b600fb5ba2b26e271235e  -`.
- [x] G5: compile, TypeScript unit, and Next owner claims from Task 01.4 — result:
  all final claims exited 0. `verify:unit:ts` passed 25 files and 249 tests;
  the Next owner production build extracted 15 of 15 components and its CSS,
  JavaScript, App Router, and Pages Router assertions passed.

## Output contract

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Confirmed **Authors** is envelope-owned; no requirement draft is owed
- [x] Guardrail gate results recorded above, with output excerpts
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates): none, or decision-shaped unknowns
  with a concrete resolving signal
- [x] Return status as `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or
  `BLOCKED`, plus the exact changed-path list and RED/GREEN/verification evidence

## Implementation evidence

- **RED**: the focused public-boundary test reached its behavioral assertion
  and failed because the received plugin options omitted exactly `extensions`
  and `layers` (1 failed test; no import, type, or setup failure).
- **GREEN**: after forwarding the original `AnimusNextOptions` object, the
  focused test passed 1 of 1. The final post-README/format run also passed 1 of
  1.
- **Formatting**: the initial three-file formatter check identified only the
  new test. Formatting those three footprint files and rerunning the exact
  check exited 0 with all three accepted.
- **Mapped verification**: `verify:compile` exited 0 for every package and
  `verify:unit:ts` passed 25 files and 249 tests. The first Next owner run
  failed loud because `packages/next-plugin/dist/` was stale and prescribed
  `vp run build:ts`; that exact preparation exited 0, after which the owner
  claim exited 0. The RepoWise omission reference from the owner run was
  expanded rather than rerunning the command.
- **Status**: `DONE`.
- **Spawn candidates**: none.

## Proposed journal entries

- **Signal**: The exported wrapper omitted `extensions` and `layers`; forwarding
  the typed options object as one unit now preserves all eight fields, proven
  through the real plugin's public `getOptions()` boundary.
- **Friction**: The Next owner claim correctly failed loud on stale
  `next-plugin/dist`; its exact `vp run build:ts` preparation unblocked the
  successful owner verification.
- **Surprise**: The original broad G2 pattern also matched the intentional
  loader-only `strict` option. Root narrowed the guardrail to the plugin
  injection block, preserving the loader behavior while enforcing D1.

## Reviewer objection disposition

- **Objection**: accepted. Exercising `engine: 'v1'` constructs the real plugin,
  which updates the shared `globalThis.__animus_engine__` singleton; the test's
  original cleanup restored mocks and temporary roots but not that global.
- **Repair**: the wrapper test now saves the prior singleton value in
  `beforeEach` and restores it in `afterEach`, following the established
  `singleton-v2-transform.test.ts` isolation pattern. `engine: 'v1'` remains in
  the options fixture so every supported option is still exercised.
- **Evidence**: the focused wrapper test passed 1 of 1; the targeted formatter
  accepted the test file; `verify:unit:ts` passed 25 files and 249 tests; G1,
  corrected G2, and G3 exited 0; G4 retained
  `f6f120b895f350f209739f1bda6b4e4ef8d65588063b600fb5ba2b26e271235e`.
- **Proposed disposition**: `RESOLVED` with no production, README, shared OODA,
  or additional-footprint change.

## Spec authorship checklist (orchestrator)

- [x] Confirmed envelope-authored
  `§next-config-wrapper/withAnimus config wrapper` remains black-box verifiable
  and leakage-clean
- [x] Confirmed no Decision Ledger row is resolved by this increment
- [x] Appended accepted journal entries attributed to `via inc 01 subagent`
- [x] Reorientation entry written with the full three-stance adversarial pass
  required by cadence K=1
- [x] Ticked registry row 01 with the reorientation timestamp
