# Increment 05: emission-mechanism

## Scope

- **Registry row**: 05 · mode: inline · review: subagent-if-available
- **Resolves**: DEF-2 (span-chunk dependency: DEPEND on string_wizard
  1.1.5 — spike verdict, journal 2026-07-13 01:40); implements D8's
  mechanism half
- **Authors**: — (envelope arch constraints cover it; G3 bans the
  alternative)
- **Depends on (ordering — deps:)**: 04
- **Inputs from (information — inputs:)**: none
- **Footprint**: packages/extract/crates/extract-v2/**,
  openspec/changes/extract-v2-spine/**
- **Pushes to a later increment**: replacement-TEXT assembly (the
  createComponent/createClassResolver config payloads) requires
  theme/config inputs — rides with rows 06/07 work; v1's emitter quirks
  (offset-0 directive, import stripping) are honored THERE, where the
  plan is assembled; the anticipated register entries stand.

> Licensed by the DEF-2 signal entry (journal 2026-07-13 01:40).

## Context Capsule

- **Objective**: a span-preserving emission mechanism exists in the v2
  crate: `EmissionPlan { replacements, prepend, removals }` (pure facts)
  → `apply_plan(source, plan) -> { code, map_json }` via string_wizard —
  no `replace_range`, no JSON surgery (G3), no AST access (D4 outcome:
  source + facts suffice), sourcemap produced from the same chunk model
  (NS4; shipping remains DEF-3).
- **In-scope guardrails**: G3 (gate stays empty — the mechanism is the
  sanctioned alternative), G7 (string_wizard is not an `oxc_*` direct
  dep; transitive oxc_sourcemap recorded), G6 (parity tier unaffected).

## Plan

- [x] **Step 1:** Spike = implementation: `emit.rs` with the three edit
      shapes; 4 tests (replacement, prepend+removal, composition+map,
      byte-preservation). 131 crate tests green.
- [x] **Step 2:** DEF-2 decision recorded with dependency-weight evidence.

## Guardrail gate

- [x] G3: gate empty on v2 tree (the mechanism replaces the banned
      pattern).
- [x] G7: `grep -E '^oxc'` → single umbrella line (string_wizard is a
      separate dependency; its oxc_sourcemap is transitive).
- [x] v2 `cargo test --lib`: 131/131.
- [x] G6: `PARITY GATE: PASS` (v1-vs-v1 unaffected).

## Output contract (inline mode)

- [x] Plan ticked; gates recorded; journal signal entry doubles as the
      DEF-2 resolution record; surfaced variables: none (emitter-assembly
      push recorded in Scope).

## Spec authorship checklist (orchestrator)

- [ ] Off-beat reorientation; tick row 05
