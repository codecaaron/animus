# Increment 03: session-core

## Scope

- **Registry row**: 03 · mode: inline · review: subagent
- **Resolves**: D2 (long-lived engine, whole-project re-analysis), D3
  (query-time replay attribution), D10 (production-mode truth source)
- **Authors**: — (envelope: `specs/headless-analysis-session/spec.md`,
  verdict semantics from `specs/style-verdict-contract/spec.md`)
- **Depends on (deps:)**: 01 (contract package exists), 02 (facts exist)
- **Inputs from (inputs:)**: none (both upstream shapes are fixed by the
  envelope specs; this row consumes the specs, not increment outputs)
- **Footprint**: `packages/_verify/src/session/**`

## Context Capsule

Read first: `specs/headless-analysis-session/spec.md` (all five
requirements), `specs/style-verdict-contract/spec.md`, `design.md` §D2, §D3,
§D10, §G1, §G2.

Repo facts:
- Headless composition to replicate (the plugins do this in `buildStart`):
  1. `loadSystemModule(systemPath, rootDir)` — NAPI, exported from
     `packages/extract/index-v2.js`; 2. file discovery — `discoverFiles` is
  exported from `packages/vite-plugin/src/index.ts`; 3. engine —
  `new ExtractEngine(options)` then `.analyze(filesJson)`. The
  options-mapping precedent is `packages/_parity/src/engine-run.ts` (maps
  theme/config/aliases JSONs onto constructor fields; NAPI `Option` fields
  take `undefined`, never `null`).
- NAPI loading contract (see `packages/_integration/CLAUDE.md`): require the
  binding by **direct file path** (`require('<repo>/packages/extract/index-v2.js')`),
  never by package name.
- Replay kernel: import `resolveClasses` (and `createClassResolver`) from
  `packages/system/src/runtime/` — pure, dependency-free. Predicted winner
  for a property = replay class selection, join per-layer
  `component_fragments` from the manifest, order by the static cascade
  (layer order `base < variants < compounds < states < system < custom`,
  standalone < composed sublayers, shorthand-before-longhand within a tier,
  source order last). Authoring attribution joins `fileFacts` stage spans.
- Fixture workspace for tests: `packages/_integration/fixtures/` (real
  builder-chain `.tsx` files + `fixtures/setup.ts` serialized system).
- Manifest is parsed once per analysis into a `SessionIndex` (component
  table, extension DAG from `extends_from`/`reverse_provenance`, callsite
  and spread indexes from the increment-02 fields, prop/value maps).

Deliverables (`packages/_verify/src/session/`): `analyzeWorkspace.ts`,
`index.ts` (SessionIndex), `replay.ts` (predictWinner), `queries.ts`
(`explainComponent`, `explainProperty`), `session.ts` (state retention +
file-watch re-analysis + mode gate).

## Plan

- [ ] 1. Failing test `__tests__/analyze-workspace.test.ts`: `analyzeWorkspace(fixtureDir, {mode:'production'})` returns a manifest with ≥1 component and a mode stamp, with no server running.
- [ ] 2. Implement `analyzeWorkspace` (system load → discovery → engine → stamped manifest). Run; expected: PASS.
- [ ] 3. Failing test: two `explainComponent` calls without edits reuse one analysis (spy on the engine call count); an edit to a fixture copy triggers exactly one re-analysis.
- [ ] 4. Implement `session.ts` retention + re-analysis. PASS.
- [ ] 5. Failing test `__tests__/mode-gate.test.ts` (G2's named check): verdict query against a dev-mode manifest returns a mode-mismatch error, not an answer.
- [ ] 6. Implement the mode gate at query entry. PASS.
- [ ] 7. Failing test: `explainProperty('padding', …)` names the winning declaration, its authoring file+span, its cascade position, and each overridden declaration (fixture with base + variant + system-prop collision on padding).
- [ ] 8. Implement `replay.ts` + `queries.ts` returning `VerdictEnvelope`s from the contract package. PASS.
- [ ] 9. Failing test `__tests__/spread-verdict.test.ts` (G1's named check): a fixture element with `{...rest}` yields verdict `unverifiable` with the spread's file+span, never `exact`.
- [ ] 10. Implement spread-marker consultation in verdict assembly. PASS.
- [ ] 11. Checkpoint: `vp run verify:compile && bunx vp test run packages/_verify/__tests__/`; expected: PASS. G1 and G2 flip to `active` in design.md's register (orchestrator).

## Guardrail gate

Arms G1 and G2 (their named test files land here — commands in design.md's
fenced blocks). Both must PASS before ticking.

## Spec authorship checklist

- [x] — (envelope)
