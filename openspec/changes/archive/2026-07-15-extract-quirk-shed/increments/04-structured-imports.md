# Increment 04: structured-imports

## Scope

- **Registry row**: 04 · mode: delegate (reorientation mode-change
  2026-07-13 15:41) · review: subagent
- **Resolves**: —
- **Authors**: §transform-evaluation-contract/Imports are emitted only
  for referenced runtime capabilities — authored at propose (envelope).
- **Depends on (deps:)**: increment 03
- **Inputs from (inputs:)**: none
- **Footprint**: packages/extract/crates/extract-v2/src/**,
  packages/extract/crates/extract-v2/index.d.ts, packages/_parity/**,
  openspec/changes/extract-quirk-shed/**
- **Pushes to a later increment**: none

## Context Capsule

- **Objective**: v2 decides runtime/virtual-module import emission from
  structured replacement metadata (which transforms/registries the
  replacement's config actually references), not by substring-grepping
  the generated replacement text. A user string containing e.g.
  `transforms.` no longer triggers a spurious import.
- **In-scope guardrails** (STOP): G2, G3, G4 — commands as increment 01.
- **Requirement being implemented** (verbatim): "Runtime and
  virtual-module imports SHALL be emitted only when the transformed
  output requires the corresponding runtime capability; user string
  content SHALL NOT trigger imports." Scenario: component
  style/config value contains literal `transforms.` → no
  transforms-registry import unless the transformed component references
  a named transform.
- **Known witnesses**: register entry `extract-all` (code,
  known-quirk, anticipated): "v1 decides import emission by
  substring-grep of generated replacement text; user strings containing
  e.g. 'transforms.' trigger spurious imports. v2 must reproduce until
  flipped."
- **Relevant resolved decisions**: D1; D3 (no v1 backport — pure output
  shed).
- **In-scope North Star**: NS1 (wrong→right), NS2, NS3.
- **Prohibitions**: as increment 03 (footprint-only; register.json +
  corpus writable; _parity/src untouchable; no v1 edits).

## Plan

## Task 04.1: implement structured import decisions

- [x] **Step 1:** Locate the v2 grep-mirror:
  `rg -n 'contains|transforms\.' packages/extract/crates/extract-v2/src/emit.rs packages/extract/crates/extract-v2/src/*.rs | head`.
  Identify every import decision made by substring inspection of
  generated text.
  (Found eight decisions in `engine.rs`: `createComponent`,
  `createClassResolver`, `systemPropMap`, `systemPropGroups`,
  `dynamicPropConfig`, `transforms`, `createComposedFamily`, and
  `createComposedFamilyWithContext`.)
- [x] **Step 2:** Replace with decisions from the structured facts the
  emitter already holds (replacement config: does it reference a named
  transform / virtual module / runtime helper?). Thread metadata if
  needed; do NOT re-parse generated text.
  (`replacement_import_needs` now reads only surviving `ChainFacts` and
  `ReplacementPayload`: terminal kind chooses component/class helpers;
  `system_prop_names`, `system_group_names`, `has_dynamic_props`, and
  named entries in `custom_dynamic_config` without a higher-precedence
  inline transform source choose virtual imports.
  `FileFacts.compose[].context` chooses both compose helpers. No emitted
  replacement string participates. Direct helper tests cover survivor
  filtering, component/class terminals, group/map/dynamic registries,
  and named-only/inline-only/both-present transform metadata. End-to-end
  tests cover the separate compose-with-context import/directive path
  and the intentional unchanged-source early return for compose-only
  files with no surviving component payload.)
- [x] **Step 3:** Add a corpus witness if none exists: a fixture whose
  style value contains the literal string `"transforms."` in user
  content (e.g. `packages/_parity/corpus/string-transforms-literal.tsx`),
  registered in `families.json` if the corpus requires it (mirror how
  existing .tsx units are listed).
  (`string-transforms-literal.tsx` retains the literal as a harmless
  `defaultVariant` config value; its family expects registered
  divergence.)
- [x] **Step 4:** `cargo test --lib` — green. Rebuild v2 binary.
  (Fresh final run: 303 passed, 0 failed; two pre-existing warnings.
  After the final test-only edits, the orchestrator reran
  `vp run verify:unit:rust` (280 passed, 1 ignored) and
  `vp run build:extract-v2`; the release build exited 0. The build
  deterministically refreshed the tracked NAPI declaration comment in
  `index.d.ts`, so that generated file is included in the row footprint.)

## Task 04.2: license + gates

- [x] **Step 1:** Flip the `extract-all` code known-quirk entry →
  intentional-correctness, active, note: v2 derives imports from
  structured replacement metadata (shed 2026-07-13, inc 04); v1 retains
  the grep until retirement. License the new corpus unit's divergence
  if v1/v2 differ on it.
  (Quality-review correction: the final scoreboards show no
  `extract-all · code` divergence, so that aggregate surveillance row
  is intentional-correctness but `anticipated`, not active. The new
  `parity/string-transforms-literal.tsx · code` row owns the observed
  active intentional-correctness license.)
- [x] **Step 2:** `bash scripts/verify/parity.sh | tail -1` → PASS.
  (Unlicensed RED first: both prod/dev reported exactly 1 unregistered
  divergence, the new unit's code artifact. Licensed GREEN: prod 23 and
  dev 27 total divergences, both 0 unregistered; final line
  `PARITY GATE: PASS`. The orchestrator repeated the full gate after the
  final source rebuild at 16:16 with the same 23/27, 0-unregistered
  result.)
- [x] **Step 3:** Consumer oracles:
  `vp run verify:vite && vp run verify:next && vp run verify:showcase` — green.
  (All three builds exited 0; Vite, Next App+Pages, and showcase
  assertions passed. The orchestrator reran all three after the final
  source rebuild; every build and assertion tier passed again.)

## Guardrail gate

- [x] G2 — result: PASS —
  `git status --short packages/_parity/src/compare.ts packages/_parity/src/scoreboard.ts`
  produced empty output.
- [x] G3 — result: PASS — fresh final
  `bash scripts/verify/parity.sh | tail -1` printed
  `PARITY GATE: PASS` (0 unregistered in both modes).
- [x] G4 — result: PASS —
  `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs`
  exited 0.

## Output contract (delegated)

- [x] Plan checkboxes ticked
- [x] Diff summary; the structured decision source (what metadata now
      drives each import kind)
- [x] Gate results with excerpts
- [x] Proposed journal entries — two returned below
- [x] Surfaced variables — none beyond the already-carried row-07
      same-engine family-reporting friction

### Returned evidence

- **RED/GREEN**: focused Rust RED exited 101 because the retained
  `"default":"transforms."` text caused a spurious transforms import;
  focused GREEN passed after structured selection. The unlicensed
  parity RED then proved the new code artifact, and the licensed run
  passed with 0 unregistered. Quality-review RED separately proved that
  both-present custom-transform metadata incorrectly imported the
  registry despite inline-source precedence; the 24-test engine-focused
  GREEN covers named-only, inline-only, both-present, and survivor cases.
  The follow-up compose-focused characterization run passed 3/3: the
  context helper uses its separate module without contaminating the base
  runtime import, the consumed binding is stripped, `'use client'` stays
  first, and compose-only/no-survivor input returns byte-identical source
  with `hasComponents: false` and no empty import.)
- **Exact row-04 diff**: `engine.rs` adds the structured import-needs
  derivation and direct regression tests; the new corpus fixture plus
  `families.json` pin the witness; `register.json` retains `extract-all`
  as anticipated surveillance and licenses only the observed dedicated
  code artifact; `scoreboard.snap` and
  `self-check.snap` record the 48-unit corpus; the generated `index.d.ts`
  comment reflects the new import-decision source; this packet records
  the receipts.
- **Proposed journal · surprise**: the first witness placed
  `transforms.` in a variant option, which creates invalid selector
  syntax in both engines; moving the literal to `defaultVariant`
  isolated import emission and removed all CSS-side divergence.
- **Proposed journal · friction**: the new registered-divergence family
  makes same-engine self-check output say `VIOLATED ... observed
  identical`, the same bounded reporting friction already carried to
  row 07; the real v1/v2 family verdict is `ok` and the parity gate
  passes.

## Spec authorship checklist (orchestrator)

- [x] Envelope spec covers row
- [x] Journal + tick row 04 `· ticked: 2026-07-13 16:16`
