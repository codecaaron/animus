# Increment 02: Compose consumer webpack first

## Scope

- **Registry row**: 02 · mode: delegate · review: subagent
- **Resolves**: D4, D5
- **Authors**: — (the envelope's modified `next-config-wrapper` requirement
  already covers the missing-system diagnostic and existing-hook composition)
- **Depends on (ordering — deps:)**: increment 01
- **Inputs from (information — inputs:)**: none
- **Footprint**:
  `packages/next-plugin/src/with-animus.ts`,
  `packages/next-plugin/tests/with-animus.test.ts`
- **Pushes to a later increment**: none; return any new decision-shaped
  unknown with a concrete resolving signal rather than expanding this packet

> Resolving signal that licensed creating this increment now: envelope and
> reorientation licensing for decided-now D4-D5 after the 2026-07-19 04:46
> accepted reviewer objection and live replacement-config reproduction; no
> deferred Ledger row is resolved.

## Context Capsule

- **Objective**: `withAnimus` currently injects its plugin, aliases, and loader
  before calling a consumer's existing webpack hook. A valid consumer hook
  that returns a replacement configuration therefore discards every Animus
  addition; a live reproduction returned `pluginCount: 0` and `ruleCount: 0`.
  Add a failing public-boundary regression, call the consumer hook first, then
  inject Animus into the returned configuration. Also characterize the
  established missing-system diagnostic required by the amended envelope.
- **Repository constraints**: Work in
  `/Users/sugarat/agent-workspaces/me-im-counting/animus` on the existing
  `chore/refactor-town` checkout. Root `AGENTS.md` forbids every mutative Git
  operation. Preserve all pre-existing dirty Rust, integration, completed
  OODA, and increment-01 work. Use `bun` for package management, `vp` for task
  orchestration, and `repowise distill` for noisy tests/builds/lints. Expand
  any `[repowise#<ref>]` marker instead of rerunning merely to reveal output.
- **Current source seam**: In exported function `withAnimus` in
  `packages/next-plugin/src/with-animus.ts`, the returned `webpack` function
  injects Animus into its `config` parameter and only near the end calls
  `existingWebpack(config, context)`. The minimal intended shape is to call
  `existingWebpack` at the beginning, assign its returned `WebpackConfig` back
  to the working `config`, perform all existing Animus injection unchanged,
  and return `config` once at the end.
- **Current test seam**: `packages/next-plugin/tests/with-animus.test.ts`
  already owns a temporary-root cleanup harness and an option-forwarding test
  using the exported wrapper plus real `AnimusWebpackPlugin`. Extend this file;
  do not add another harness.
- **Existing spec context**: Change-level
  `specs/next-config-wrapper/spec.md` contains the full modified
  `### Requirement: withAnimus config wrapper`. Its missing-system scenario
  requires the established `[animus-extract] Missing required option` message
  with curried usage guidance. Its existing-webpack scenario requires calling
  the consumer hook first, then adding the plugin and loader to its result.
- **Relevant resolved decisions**:
  - D1: keep forwarding the original typed options object to the plugin.
  - D4: keep and test the established actionable missing-system diagnostic.
  - D5: call the consumer hook first and inject into its returned config.
- **Upstream inputs**: none; increment 01 supplies ordering only and its current
  source/test state is present in this packet's target files.
- **In-scope North Star criteria**:
  - NS1: keep whole-object option forwarding intact.
  - NS2: public requirements and tests describe the curried wrapper API.
  - NS3: change only the wrapper composition seam and its owner test.
- **In-scope guardrails**:
  - G1 — SHALL NOT modify `packages/next-plugin/src/plugin.ts` — STOP.

    ```bash
    git diff --exit-code -- packages/next-plugin/src/plugin.ts
    ```

  - G2 — SHALL NOT reintroduce a hand-copied plugin-options allowlist — STOP.

    ```bash
    sed -n '/\/\/ Inject AnimusWebpackPlugin/,/config.plugins.push(plugin)/p' packages/next-plugin/src/with-animus.ts | rg -n 'new AnimusWebpackPlugin\(options\)'
    if sed -n '/\/\/ Inject AnimusWebpackPlugin/,/config.plugins.push(plugin)/p' packages/next-plugin/src/with-animus.ts | rg -n 'system: options\.system|exclude: options\.exclude|extensions: options\.extensions|strict: options\.strict|verbose: options\.verbose|prefix: options\.prefix|engine: options\.engine|layers: options\.layers'; then exit 1; fi
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
  inspection; no writes outside the declared footprint plus this packet;
  never write `design.md`, `tasks.md`, `journal.md`, or `specs/`; return
  proposed entries to the orchestrator. Treat any skill-emitted commit point
  as a logical checkpoint only.

## Plan

## Task 02.1: Lock the inherited diagnostic and reproduce composition loss

- [x] **Step 1: Extend the existing wrapper tests.** In
  `packages/next-plugin/tests/with-animus.test.ts`, add these two tests inside
  the existing `describe('withAnimus', ...)` block. Preserve the existing
  temporary-root harness and option-forwarding test.

  ```ts
  test('reports a missing system with curried usage guidance', () => {
    expect(() => withAnimus({} as AnimusNextOptions)).toThrow(
      '[animus-extract] Missing required option `system`. ' +
        'Provide the path to your SystemInstance module: ' +
        'withAnimus({ system: "./src/ds.ts" })'
    );
  });

  test('adds Animus configuration after the consumer webpack hook', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-next-composition-'));
    temporaryRoots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const replacementConfig = { plugins: [] };
    const consumerWebpack = vi.fn(() => replacementConfig);
    const wrapped = withAnimus({ system: './src/ds.ts' })({
      webpack: consumerWebpack,
    });
    const incomingConfig = {};
    const context = {};

    const config = wrapped.webpack?.(incomingConfig, context);

    expect(consumerWebpack).toHaveBeenCalledWith(incomingConfig, context);
    expect(config).toBe(replacementConfig);
    expect(
      config?.plugins?.some(
        (candidate) => candidate instanceof AnimusWebpackPlugin
      )
    ).toBe(true);
    expect(config?.module?.rules).toHaveLength(1);
    expect(config?.resolve?.alias?.['.animus/styles.css']).toBe(
      join(root, '.animus', 'styles.css')
    );
  });
  ```

- [x] **Step 2: Run the composition regression and record a genuine RED.**

  ```bash
  repowise distill bunx vp test run packages/next-plugin/tests/with-animus.test.ts -t 'adds Animus configuration after the consumer webpack hook'
  ```

  Expected: the test reaches the behavioral assertion and fails because the
  replacement config contains no `AnimusWebpackPlugin`, loader rule, or
  `.animus/styles.css` alias. Import, type, or setup failures are not an
  accepted RED; correct only test setup until the behavioral assertion fails.

- [x] **Step 3: Run the missing-system characterization before source editing.**

  ```bash
  repowise distill bunx vp test run packages/next-plugin/tests/with-animus.test.ts -t 'reports a missing system with curried usage guidance'
  ```

  Expected: 1 pass, 0 fail. This is a characterization of established behavior,
  not the RED that licenses the composition production change.

## Task 02.2: Compose the consumer hook before Animus injection

- [x] **Step 1: Apply the minimal production fix.** At the start of the
  returned `webpack(config, context)` body in
  `packages/next-plugin/src/with-animus.ts`, before resolving `rootDir`, add:

  ```ts
  if (typeof existingWebpack === 'function') {
    config = existingWebpack(config, context);
  }
  ```

  At the end of that body, remove only the old `if (typeof existingWebpack ===
  'function')` block and retain the single `return config;`. Do not reorder or
  change any Animus injection logic, plugin options, loader options, aliases,
  filesystem behavior, or plugin internals.

- [x] **Step 2: Re-run the focused wrapper file and record GREEN.**

  ```bash
  repowise distill bunx vp test run packages/next-plugin/tests/with-animus.test.ts
  ```

  Expected: all 3 wrapper tests pass, 0 fail, with no warnings or errors.

## Task 02.3: Format and run repository-mapped verification

- [x] **Step 1: Run the focused formatter check.**

  ```bash
  vp fmt --check packages/next-plugin/src/with-animus.ts packages/next-plugin/tests/with-animus.test.ts
  ```

  Expected: exit 0. If it reports drift, format only those two files with the
  repository formatter, then rerun this exact check.

- [x] **Step 2: Run the focused wrapper tests once more after formatting.**

  ```bash
  repowise distill bunx vp test run packages/next-plugin/tests/with-animus.test.ts
  ```

  Expected: 3 pass, 0 fail.

- [x] **Step 3: Run root compile.**

  ```bash
  repowise distill vp run verify:compile
  ```

  Expected: exit 0 for every package.

- [x] **Step 4: Run TypeScript units.**

  ```bash
  repowise distill vp run verify:unit:ts
  ```

  Expected: exit 0 with no failed tests.

- [x] **Step 5: Run the Next consumer owner claim.**

  ```bash
  repowise distill vp run @animus-ui/next-app#verify
  ```

  Expected: production build and all positional assertions exit 0. Atomic
  prerequisites fail loud; perform only their exact prescribed preparation,
  then rerun the owner claim. Expand omission refs instead of rerunning merely
  to reveal distilled output.

## Guardrail gate

- [x] G1: `git diff --exit-code -- packages/next-plugin/src/plugin.ts` — result:
  exit 0 with no diff.
- [x] G2: constructor whole-object/partial-copy check from the Context Capsule — result:
  exit 0; the injection block reported
  `const plugin = new AnimusWebpackPlugin(options);` and no partial-copy field.
- [x] G4: preserved-diff SHA-256 check from the Context Capsule — result:
  exit 0 with
  `f6f120b895f350f209739f1bda6b4e4ef8d65588063b600fb5ba2b26e271235e  -`.
- [x] G5: compile, TypeScript unit, and Next owner claims from Task 02.3 — result:
  all final claims exited 0. Compile passed every package; TypeScript units
  passed 25 files and 251 tests; the Next owner build extracted 15 of 15
  components and its CSS, JavaScript, App Router, and Pages Router assertions
  passed.

## Output contract

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Confirmed **Authors** is envelope-owned; no requirement draft is owed
- [x] Guardrail gate results recorded above, with output excerpts
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates): none, or decision-shaped unknowns
  with a concrete resolving signal
- [x] Return status as `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or
  `BLOCKED`, plus exact changed paths and RED/GREEN/verification evidence

## Implementation evidence

- **RED**: the focused composition test reached the consumer replacement
  config and failed at the first Animus-addition assertion: its plugin scan was
  `false` instead of `true` (1 failed, 2 skipped; no import, type, or setup
  failure).
- **Characterization**: before source editing, the focused missing-system test
  passed 1 of 1 and retained the established diagnostic with curried usage
  guidance.
- **GREEN**: after moving the existing consumer hook call to the start of the
  wrapper body, all 3 wrapper tests passed. The post-format run also passed all
  3 tests.
- **Formatting**: the exact two-file formatter check exited 0 with both files
  accepted.
- **Mapped verification**: `verify:compile` passed every package and
  `verify:unit:ts` passed 25 files and 251 tests. The first Next owner run
  failed loud because `packages/next-plugin/dist/` was stale and prescribed
  `vp run build:ts`; that exact preparation exited 0, after which the owner
  claim exited 0. RepoWise ref `993d55320216` was expanded rather than
  rerunning and confirmed 15-of-15 extraction plus successful build and
  positional assertions.
- **Status**: `DONE`.
- **Spawn candidates**: none.

## Proposed journal entries

- **Signal**: A consumer webpack hook that returned a replacement config
  discarded every pre-hook Animus mutation. Calling the hook first and
  injecting into its returned config preserves the plugin, loader, and CSS
  alias without changing their construction.
- **Friction**: The Next owner claim correctly failed loud on stale
  `next-plugin/dist`; its exact `vp run build:ts` preparation unblocked the
  successful owner verification.
- **Surprise**: The established missing-system diagnostic already matched the
  amended envelope exactly, so increment 02 only characterized it and made no
  diagnostic source change.

## Spec authorship checklist (orchestrator)

- [x] Confirmed envelope-authored
  `§next-config-wrapper/withAnimus config wrapper` matches diagnostic and
  hook-first behavior and remains leakage-clean
- [x] Confirmed no Decision Ledger row is resolved by this increment
- [x] Appended accepted journal entries attributed to `via inc 02 subagent`
- [x] Reorientation entry written with the full three-stance pass required by K=1
- [x] Ticked registry row 02 with the reorientation timestamp
