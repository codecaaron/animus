# Increment 04: structured-imports

## Scope

- **Registry row**: 04 · mode: inline (delegated — journal mode-change
  2026-07-13 03:25) · review: subagent
- **Resolves**: —
- **Authors**: §transform-evaluation-contract/Import emission derives
  from structured decisions — authored at propose (envelope).
- **Depends on (deps:)**: increment 03
- **Inputs from (inputs:)**: none
- **Footprint**: packages/extract/crates/extract-v2/src/**,
  packages/_parity/**, openspec/changes/extract-quirk-shed/**
- **Pushes to a later increment**: none

## Context Capsule

- **Objective**: v2 decides runtime/virtual-module import emission from
  structured replacement metadata (which transforms/registries the
  replacement's config actually references), not by substring-grepping
  the generated replacement text. A user string containing e.g.
  `transforms.` no longer triggers a spurious import.
- **In-scope guardrails** (STOP): G2, G3, G4 — commands as increment 01.
- **Requirement being implemented** (verbatim): "Runtime and
  virtual-module import decisions SHALL derive from the structured
  replacement metadata, not substring matching over generated text;
  user string content SHALL NOT trigger imports." Scenario: component
  style/config value contains literal `transforms.` → no
  transforms-registry import unless the structured config references a
  named transform.
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

- [ ] **Step 1:** Locate the v2 grep-mirror:
  `rg -n 'contains|transforms\.' packages/extract/crates/extract-v2/src/emit.rs packages/extract/crates/extract-v2/src/*.rs | head`.
  Identify every import decision made by substring inspection of
  generated text.
- [ ] **Step 2:** Replace with decisions from the structured facts the
  emitter already holds (replacement config: does it reference a named
  transform / virtual module / runtime helper?). Thread metadata if
  needed; do NOT re-parse generated text.
- [ ] **Step 3:** Add a corpus witness if none exists: a fixture whose
  style value contains the literal string `"transforms."` in user
  content (e.g. `packages/_parity/corpus/string-transforms-literal.tsx`),
  registered in `families.json` if the corpus requires it (mirror how
  existing .tsx units are listed).
- [ ] **Step 4:** `cargo test --lib` — green. Rebuild v2 binary.

## Task 04.2: license + gates

- [ ] **Step 1:** Flip the `extract-all` code known-quirk entry →
  intentional-correctness, active, note: v2 derives imports from
  structured replacement metadata (shed 2026-07-13, inc 04); v1 retains
  the grep until retirement. License the new corpus unit's divergence
  if v1/v2 differ on it.
- [ ] **Step 2:** `bash scripts/verify/parity.sh | tail -1` → PASS.
- [ ] **Step 3:** Consumer oracles:
  `vp run verify:vite && vp run verify:next && vp run verify:showcase` — green.

## Guardrail gate

- [ ] G2 — result: <record>
- [ ] G3 — result: <record>
- [ ] G4 — result: <record>

## Output contract (delegated)

- [ ] Plan checkboxes ticked
- [ ] Diff summary; the structured decision source (what metadata now
      drives each import kind)
- [ ] Gate results with excerpts
- [ ] Proposed journal entries — or none
- [ ] Surfaced variables — or none

## Spec authorship checklist (orchestrator)

- [ ] Envelope spec covers row
- [ ] Journal + tick row 04 `· ticked: <ts>`
