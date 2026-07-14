# Increment 08: warn-diagnostic-surfacing

## Scope

- **Registry row**: 08 · mode: delegate · review: subagent
- **Resolves**: DEF-5 → D5
- **Authors**: §extraction-diagnostics/Unresolved-alias leaks are
  diagnosed — envelope requirement already authored.
- **Depends on (deps:)**: increment 01
- **Inputs from (inputs:)**: increment 01 — manifest warn diagnostics
  use `{ file, component, kind, message }`; the unresolved-alias message
  contains property and alias context.
- **Footprint**: packages/vite-plugin/src/**,
  packages/vite-plugin/tests/**, packages/next-plugin/src/**,
  packages/next-plugin/tests/**,
  openspec/changes/extract-quirk-shed/**
- **Pushes to a later increment**: none

## Context Capsule

- **Objective**: every Vite and Next analysis path that consumes an
  extraction manifest surfaces diagnostics of kind `warn` through an
  always-on developer warning channel. Output includes file, component,
  and the diagnostic message, whose increment-01 alias witness contains
  property and unresolved-alias context. Existing `bail` and `skip`
  output remains intact.
- **Observed gap**: Vite's manifest loop in
  `packages/vite-plugin/src/index.ts` handles `bail` and `skip` but has no
  `warn` arm. Next parses manifests in the full production and HMR
  analysis paths in `packages/next-plugin/src/plugin.ts` but does not
  surface manifest diagnostics at either site.
- **Requirement being implemented** (verbatim): "Token aliases that
  cannot resolve SHALL produce a warn diagnostic." Scenario: dev-mode
  analysis encounters an unresolvable alias → the plugin diagnostics
  channel surfaces the warn entry with file and property context.
- **Relevant resolved decisions**: D3 (shared plugin contract may be
  implemented in both adapters); D5 (always-on warn channels in every
  manifest-consuming analysis path).
- **In-scope guardrails** (STOP): G2, G3, G4 — commands from design.md.
- **In-scope North Star**: NS1 (silent→loud), NS3 (the spec'd
  diagnostic reaches the developer rather than ending at the manifest).
- **Prohibitions**: no extraction-engine behavior changes; no manifest
  schema changes; no VCS mutations; no edits outside the footprint; do
  not gate warn output on verbose mode; do not duplicate a warning for a
  manifest consumed twice within the same analysis path.

## Plan

## Task 08.1: specify the formatter and manifest behavior with failing tests

- [x] **Step 1:** Read the diagnostic loops and all manifest parse sites:
  `rg -n "diagnostics|JSON.parse\(manifestJson\)|kind === 'bail'|kind === 'skip'" packages/vite-plugin/src packages/next-plugin/src`.
  Record the full production and HMR paths that require the same behavior.
  Vite parses every initial/new-file/HMR result in the shared
  `runAnalysis()` path; Next parses separately in `runFullPipeline()` and
  `runIncrementalPipeline()`.
- [x] **Step 2:** Add focused Vitest coverage under the plugin test
  footprints. Extract the smallest shared-within-package formatter or
  surfacing helper needed to test behavior without constructing Vite or
  Webpack. RED assertions SHALL cover:
  - a `warn` diagnostic yields one warning containing file, component,
    and message (including property/alias text in the witness);
  - Vite's existing `bail` and `skip` wording remains supported; Next
    surfaces only the D5-authorized `warn` kind;
  - an unknown diagnostic kind does not masquerade as a warn;
  - the Next production and HMR manifest paths both call the same
    surfacing behavior.
- [x] **Step 3:** Run the focused tests and preserve the failing output:
  `bunx vp test run packages/vite-plugin/tests packages/next-plugin/tests`.
  RED (2026-07-13 17:31 EDT): 2 files failed, 5 assertions failed;
  warn/bail/skip collectors received `[]`, and the Next source-wiring
  assertion found 0 shared-helper calls rather than 2.
  Review RED (2026-07-13 17:40 EDT): Next's narrowed contract expected
  no output for bail/skip but received both legacy Vite-formatted lines.

## Task 08.2: surface manifest warn diagnostics in both adapters

- [x] **Step 1:** Implement the Vite `warn` arm using the existing
  plugin `warn()` channel. Format the line with `file`, `component`, and
  `message`; do not require verbose mode.
- [x] **Step 2:** Add the equivalent always-on Next warning channel and
  invoke it immediately after each production/HMR manifest parse. Keep
  the logic centralized so both paths cannot drift. Preserve existing
  extraction timing and CSS assembly behavior.
- [x] **Step 3:** Re-run the focused tests; all RED cases must turn
  GREEN. Run `vp run verify:compile`.
  GREEN: 5 files / 19 tests passed; compile passed for all 9 packages.
  The Next wiring test slices `runFullPipeline()` and
  `runIncrementalPipeline()` independently, requiring exactly one helper
  call immediately after `JSON.parse(manifestJson)` in each section.

## Task 08.3: integration and consumer proofs

- [x] **Step 1:** Run `vp run verify:integration`.
  Result: 10 files / 138 tests passed.
- [x] **Step 2:** Run the plugin-source verification set from the root
  Change-Type Map:
  `vp run verify:showcase && vp run verify:vite && vp run verify:next`.
  Result: all three consumer builds and positional assertion tiers passed.
  Post-review Next rerun also passed and emitted no pre-existing `skip`
  diagnostic, confirming the channel is `warn`-only.
- [x] **Step 3:** Run `bash scripts/verify/parity.sh | tail -1` →
  `PARITY GATE: PASS`. This row changes display only; manifest artifacts
  and divergence counts SHALL remain unchanged.
  Result: `PARITY GATE: PASS`; scoreboard remains 23 production / 27
  development divergences, 0 unregistered in both modes.

## Guardrail gate

- [x] G2 — result: empty status for `compare.ts` and `scoreboard.ts`;
  no harness comparison-code edit
- [x] G3 — result: `PARITY GATE: PASS`
- [x] G4 — result: v1 `index.js` and `src/lib.rs` presence probe exit 0

## Output contract (delegated)

- [x] Plan checkboxes ticked with RED/GREEN evidence
- [x] Exact warning format for Vite and Next, with one alias witness
- [x] Manifest parse sites covered by the shared behavior
- [x] Verification results with output excerpts
- [x] Proposed journal entries and surfaced variables — or none

## Returned evidence (delegate)

- **Files:** added matching package-local
  `src/manifest-diagnostics.ts` helpers and focused tests; wired Vite's
  shared `runAnalysis()` path plus Next's production and HMR parse sites.
- **Warning format (both adapters):** the developer channel receives
  `[animus] ⚠ <file>: <component>: <message>`. Alias witness:
  `[animus] ⚠ src/broken.tsx: Broken: unresolvable token alias
  {colors.missing} in 'border' — declaration dropped`.
- **Preserved Vite wording:** bail remains
  `[animus] ⚠ <component> not extracted: <message>`; skip remains
  `[animus] ⚠ <component>: skipped <message>`. Next ignores bail, skip,
  and unknown kinds; Vite ignores unknown kinds.
- **Always-on channels:** Vite passes helper output to its existing
  logger-aware `warn()` function. Next passes helper output to a class
  `warn()` function backed by `console.warn`. Neither path checks verbose.
- **No duplicate consumption:** Vite moved the former build-start
  bail/skip loop into `runAnalysis()`, so each parsed result is surfaced
  once while also covering new-file and HMR analyses. Next calls the same
  package-local helper once immediately after each of its two JSON parse
  sites; the test proves this separately inside the full-production and
  incremental-HMR method sections rather than by aggregate call count.
- **Additional quality gate:** `vp run verify:lint` passed with 0 lint
  warnings/errors and formatter check clean. Post-review parity remained
  `PARITY GATE: PASS`.
- **Proposed journal entries:** `test-red` (five focused assertion
  failures proved missing display + Next wiring); `implementation`
  (always-on warn arm landed in all parse paths); `verification` (focused,
  compile, integration, consumers, parity, G2/G3/G4 green); optional
  `friction` (first showcase attempt failed loud because Vite plugin
  `dist/` was stale, then passed after the prescribed package build);
  `objection-accepted` (Next narrowed from bail/skip/warn to D5's warn-only
  contract and source-wiring proof split by production/HMR path).
- **Surfaced variables:** none.

## Spec authorship checklist (orchestrator)

- [x] Envelope requirement and dev-surfacing scenario match the output
- [x] DEF-5/D5 remain coherent with the landed implementation
- [x] Journal + tick row 08 `· ticked: 2026-07-13 17:42`
