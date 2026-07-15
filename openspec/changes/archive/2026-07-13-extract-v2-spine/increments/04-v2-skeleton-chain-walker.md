# Increment 04: v2-skeleton-chain-walker

## Scope

- **Registry row**: 04 · mode: inline · review: subagent
- **Resolves**: D4 (implements the owned-AST store), D9 (implements the
  containment modules), D3 partially (bug-compatible resolution mode is
  established here; the post-flip symbol increment completes it)
- **Authors**: — (envelope; `arch-extract-v2-spine` §Single-parse analysis
  budget and the harness specs cover this row)
- **Depends on (ordering — deps:)**: 03 (needs the v2 build target and
  harness tier; packet content derives from envelope specs, not from 03's
  outputs)
- **Inputs from (information — inputs:)**: none
- **Footprint**: packages/extract/\*\* (v2 tree per the DEF-10 layout
  recorded at increment 03's tick — read design.md §Decisions for the
  promoted layout before starting)
- **Pushes to a later increment**: stage-argument evaluation and JSX
  scanning against the owned-AST store (next spawn candidates); D4's
  falsification check (can parse-time facts replace the store?) is
  evaluated at the reorientation after this row lands

> Envelope-licensed at propose time (journal seed entry, 2026-07-12).

## Context Capsule

- **Objective**: the v2 engine parses each fixture file exactly once into
  an owned-AST store and reproduces v1's chain discovery (the
  `.asElement`/`.asComponent`/`.asClass` terminal walk) with
  bug-compatible name-based semantics, verified by the parity harness on
  the chain-discovery observables; the parse counter reports ≤1 parse per
  file (G1 arms).
- **Core structures** (reference implementations cited in brainstorm.md,
  immutable — patterns, not APIs to copy blindly):
  - Ownership module (ONE module owns this type): `self_cell!` bundling
    `{ owner: oxc Allocator + source String, dependent: Program }` with
    documented `Send` justification — the rolldown `EcmaAst`/
    `ProgramCell` shape (rolldown crates/rolldown_ecmascript), also oxc's
    type checker `SourceFile` and linter `ModuleContent`.
  - Store: index-keyed table (`IndexVec`-style, `FileIdx →
Option<OwnedAst>`) living for the analysis phase; dropped by value
    after the last reader.
  - Construction shim: ONE factory module owns any AST node construction
    (there should be near-zero in this increment — chain walking is
    read-only `Visit`).
- **Bug-compatibility contract**: v1's chain walker resolves the chain
  root by identifier NAME (v1 `chain_walker.rs`: `extends_from` captures
  literal identifier text; primary-chain root accepted regardless of
  binding). v2 reproduces this: no symbol-table shortcutting that changes
  outcomes on the shadowing/aliasing fixtures — those fixtures' declared
  verdicts (increment 02's G-USAGE frontmatter) say `identical` for this
  increment.
- **In-scope guardrails** (from design.md Register):
  - G1: `vp run verify:parity -- --parse-count` — expected: v2 parse count
    ≤ file count per fixture — STOP (ARMS at this increment)
  - G3: `rg -n 'replace_range|\[\.\..*len\(\)' <v2-src-tree>` (control on
    v1 first, expected ≥4) — expected gate: empty — STOP
  - G4: v1-import rg (command in design.md Register fenced block) —
    expected: allowlist only — STOP
  - G6: `vp run verify:parity` — scoreboard green or register-covered on
    the chain-discovery comparison — STOP
  - G7: `grep -E '^oxc' <v2 Cargo.toml>` — umbrella only — STOP
- **Comparison note**: full CSS/code parity is NOT expected at this
  increment (emission doesn't exist in v2 yet). The harness compares the
  chain-discovery observables (per-file chain descriptors: root, stages,
  spans, terminal kind) — extend the harness with this artifact class if
  increment 02 did not already provide it; that extension belongs to this
  row's footprint via packages/\_parity (coordinate: it is outside the
  declared footprint — if needed, surface as a spawn candidate instead of
  silently widening).
- **Relevant resolved decisions (constraints)**: D3 (bug-compatible), D4
  (owned-AST store), D6 (umbrella oxc), D9 (containment modules).
- **Upstream inputs**: none (design.md carries the promoted DEF-10 layout).
- **In-scope North Star criteria**: NS1 (parse once), NS2 (facts reference
  by span/id), NS5, NS6, NS7.
- **Prohibitions**: no version-control commands; no writes outside
  footprint + this file; never write design.md/tasks.md/journal.md/specs/.

## Plan

## Task 04.1: Ownership + store

- [x] **Step 1:** `owned_ast.rs` — self_cell `AstCell { AstOwner{Allocator,
      source} ; DependentProgram<'a> }` with documented `unsafe impl Send`
      (arena+source move with the cell; arena mutated only during
      single-threaded construction). Parses ONCE at construction; owned
      rendered diagnostics; v1-parity source-type selection (.tsx/.ts/.jsx/
      .mjs fallback). Cross-thread move test green.
- [x] **Step 2:** `ast_store.rs` — rayon fan-out, per-task
      `Allocator::default()` (DEF-4 open, no oxc_allocator extras),
      race-free per-store parse counting (global counter kept for the
      whole-build budget in discover_chains). N-files→N-parses test green.

## Task 04.2: Chain walk (bug-compatible)

- [x] **Step 3:** `chain_walk.rs` — read-only walk producing owned facts
      (spans as (u32,u32), no source slices), replicating v1 semantics
      including: zero-arg .extend() marker, zero-arg known methods silently
      unrecorded, unknown-method bail, v1's exact argument-span macro
      variant list with call-span fallback, name-based root capture.
- [x] **Step 4:** v1's ENTIRE 20-test chain_walker module ported VERBATIM
      as the executable compatibility contract — all pass (23 total crate
      tests). First-contact 0.139 note: BindingPattern kept v1's enum shape.

## Task 04.3: Harness wiring + gate

- [x] **Step 5:** `discover_chains(fileEntriesJson)` NAPI surface
      (BTreeMap-ordered output, errors as napi::Result — no swallowing).
      Harness-core untouched (per this packet's own coordination note);
      cross-engine comparison shipped as
      openspec/changes/extract-v2-spine/tools/chain-parity.ts against the
      strongest v1 black-box oracle (manifest components + provenance
      edges): **35 units, 110/110 v1 components discovered by v2,
      extension edges name-match, parseCount == fileCount per unit, 0
      failures.** Chain-descriptor artifact class in the harness proper is
      a spawn candidate for the stage-eval increment (oracle limitation
      recorded: manifest only witnesses SURVIVING chains; bail-path
      equivalence is covered by the ported test module, not the corpus
      oracle).

## Guardrail gate

- [x] G1: chain-parity parse budget — parseCount == fileCount for all 35
      units (harness --parse-count arms fully when v2 joins the compare
      engine set at inc 06).
- [x] G3: gate 0 matches on v2 tree (control 10 on v1).
- [x] G4: 0 hits (no path dep, no v1 symbols).
- [x] G6: `vp run verify:parity` → PARITY GATE: PASS (same registered
      css-validity baseline; v1-vs-v1 unaffected by v2 code).
- [x] G7: single umbrella `oxc =` line.
- [x] Containment: self_cell in exactly 1 file; AstBuilder in 0 files.
- [x] v2 `cargo test --lib`: 23/23.

## Output contract (inline mode — collapse into checklists above)

- [ ] Plan checkboxes ticked; guardrail results with excerpts
- [ ] Proposed journal entries; surfaced variables (expected: the D4
      falsification verdict — did the store earn its machinery? — plus
      next-port spawn candidates)

## Spec authorship checklist (orchestrator; tie-back before ticking)

- [ ] No new spec text owed (authors: —)
- [ ] Reorientation entry (FULL three-stance pass — first v2 code has
      landed; heretic stance explicitly evaluates D4's falsification path)
- [ ] Registry row 04 ticked with `· ticked: <reorientation timestamp>`
