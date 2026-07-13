# Increment 06: v2-napi-handle

## Scope

- **Registry row**: 06 · mode: inline · review: subagent
- **Resolves**: DEF-1 (NAPI surface + handle-ownership topology + extract()
  fate + canary adapter), DEF-5 (manifest transfer format)
- **Authors**: — (envelope `extraction-diagnostics` §V2 boundary error
  reporting + `dual-engine-build` scenarios cover the behavior; the
  "Explicit v2 selection… performs extraction" scenario ARMS here for the
  facts-serving half)
- **Depends on (ordering — deps:)**: 04
- **Inputs from (information — inputs:)**: 02 (harness interface for
  engine registration — satisfied/ticked)
- **Footprint**: packages/extract/crates/extract-v2/**,
  packages/extract/index-v2.js, packages/_parity/src/**,
  openspec/changes/extract-v2-spine/**
- **Pushes to a later increment**: CSS/theme production (row 07 owns the
  evaluator path + theme resolution; the handle serves FACT surfaces
  first); cross-file phase (fact-algebra engine-side — owes RF-36/37
  debts: evaluated-config oracle expansion + alias/rendering algebra
  moved from oracle TS into the engine); full manifest-shape parity.

> Licensed by DEF-1's two signal entries (journal 2026-07-12 — harness
> landed; 2026-07-13 01:55 — call-pattern grep).

## Context Capsule

- **Grep-proven production surface** (journal 01:55): plugins call ONLY
  `analyzeProject` (+`clearAnalysisCache`), `transformFile`,
  `loadSystemModule`. `extract()` has zero plugin/pipeline consumers —
  v2 OMITS it; the 197 canary tests keep running against v1, and a thin
  canary adapter (extract() ≈ analyze+transform over one file) is
  budgeted here if the parity corpus needs it post-flip.
- **Handle design (rolldown BindingBundler two-tier, design.md D7)**:
  a `#[napi]` class `ExtractEngine` holding session state (system config,
  theme, options) and per-build state (the fact store: FileFacts per
  path + content hashes for incremental invalidation — replacing v1's
  process-global FILE_CACHE). Methods (mirroring the grep'd surface):
  `analyze(fileEntries)` → builds facts (parse-once), runs cross-file
  fact algebra (alias augmentation, rendered semantics — moved INTO the
  engine, discharging RF-37), returns the fact manifest;
  `transformFile(path)` → emission plan from RETAINED source+facts (no
  manifest round-trip — NS3; emit.rs mechanism); `clearCache()`.
  loadSystemModule stays a v1-shared concern until row 07 decides the
  evaluator path (DEF-11).
- **Ownership topology (DEF-1 core)**: instances are PER-PLUGIN-INSTANCE
  (not process-global — kills RF-28's last-write-wins); next-plugin's
  owning/non-owning topology holds a shared instance via its singleton
  but keyed by config identity; vitest-worker safety = no globals beyond
  the napi env. Options arrive as ONE typed `#[napi(object)]` struct
  (D7; the 14-arg hazard's antidote), errors as data (G5).
- **Bug-compat constraints**: D3 (name-based semantics — the engine-side
  fact algebra must be property-tested against the oracle's TS mirror
  before the TS mirror is deleted); v1 quirks honored at plan assembly
  (offset-0 directive → prepend shape; import stripping spans from
  import facts — line-based quirk parity per the anticipated register
  entries).
- **In-scope guardrails**: G1 (parse budget via harness --parse-count —
  v2 joins the engine set HERE: engine-run.ts wires
  analyze/transformFile to the handle; the "does not report" note dies),
  G5 (malformed input → diagnostics; boundary test file
  packages/extract/tests/v2-boundary-errors.test.ts named by the
  register), G6 (identity green + v1-vs-v2 comparisons begin producing
  REAL divergences → register discipline), G2/G3/G4/G7 structural.
- **Prohibitions**: standard (no VCS; footprint; no shared-artifact
  writes).

## Plan

## Task 06.1: Handle + options + errors
- [x] `ExtractEngine` #[napi] class landed (engine.rs): per-instance
      two-tier state (facts + sources retained Rust-side; ASTs drop at
      analyze() return per D4); parse-count getter; fail-loud contracts
      (malformed JSON; transform-before-analyze; not-yet-implemented
      surfaces name their landing task) — 4 engine tests, 137 crate total;
      Node probe green (stateful analyze + both error paths). Typed
      options struct DEFERRED WITHIN THIS ROW to when config inputs exist
      (row 07 feeds it); OxcError-shaped diagnostics ride with the
      diagnostics-bearing surfaces (06.3+).
## Task 06.2: Engine-side cross-file fact algebra
- [x] cross_file.rs: names/resolvers/member-bindings/alias-augmentation/
      unconditional-rendering/variant+state configs — engine-computed;
      analyze() returns crossFile; oracle consumes engine output (TS
      mirror DELETED — green now proves engine capability); 141 crate
      tests; corpus oracle 35/35 green. System-prop maps ride with row
      07's config inputs.
## Task 06.3: transformFile from retained source+facts
- [x] COMPLETE — byte-identical to v1 for the whole no-config subset
      (11/11 fixtures; tools/code-parity.ts gates it): ids.rs class
      identity (corpus-pinned vs v1 manifest), assemble.rs templates +
      sorted config + import strip/directive quirks, engine.transform_file
      with v1's exact runtime-import strip derivation, trailing-newline
      quirk, and extension-survivor filter. Config-gated stages fail loud
      (row 07).
## Task 06.4: Harness wiring + parity
- [~] RE-SCOPED (journal 03:45): full harness v1-vs-v2 rows flood
      css-class divergences until row 07 gives v2 a CSS surface — arming
      then; the code artifact class gates NOW via tools/code-parity.ts
      (byte-level, stricter than the spec's AST-equivalence bar).

## Guardrail gate
- [ ] G1 / G2 / G3 / G4 / G5 / G6 / G7 — commands per the Register.

## Output contract (inline mode)
- [ ] Plan ticked; gates recorded; DEF-1 + DEF-5 resolutions drafted;
      journal entries; spawn candidates (expected: row 07 signal
      material, cross-file oracle expansion completion).

## Spec authorship checklist (orchestrator)
- [ ] Flip DEF-1, DEF-5; FULL reorientation (first real v1-vs-v2
      divergence data is heretic material); tick row 06
