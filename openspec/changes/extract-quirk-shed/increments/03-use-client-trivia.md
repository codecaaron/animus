# Increment 03: use-client-trivia

## Scope

- **Registry row**: 03 · mode: inline (delegated — journal mode-change
  2026-07-13 03:25) · review: subagent
- **Resolves**: —
- **Authors**: §transform-evaluation-contract/Directive detection
  tolerates leading trivia — authored at propose (envelope).
- **Depends on (deps:)**: increment 02
- **Inputs from (inputs:)**: none
- **Footprint**: packages/extract/crates/extract-v2/src/**,
  packages/_parity/**, openspec/changes/extract-quirk-shed/**
- **Pushes to a later increment**: none

## Context Capsule

- **Objective**: v2 recognizes `'use client'` (and other directives) in
  the ECMAScript directive-prologue position — including when preceded
  by comments or blank lines — and always injects imports BELOW the
  directive. v1's quirk (detection only at byte offset 0; a leading
  comment defeats it and imports land above the directive, breaking
  Next) becomes a licensed intentional divergence.
- **In-scope guardrails** (STOP): G2, G3, G4 — commands as increment 01.
- **Requirement being implemented** (verbatim): "`'use client'`
  detection SHALL recognize the directive in the directive prologue
  position per ECMAScript semantics, including when preceded by
  comments or blank lines; injected imports SHALL always land below
  the directive." Scenario: comment line then `'use client'` → emitted
  file keeps the directive above all import statements.
- **Known witnesses**: register entry `parity/use-client-comment.tsx`
  (code, known-quirk, status anticipated — v1 transform_emitter
  directive check at byte offset 0). Corpus units
  `use-client-comment.tsx` and `use-client-blank-line.tsx` exist.
- **Relevant resolved decisions**: D1 (flip the register entry rather
  than touching comparison); D3 (no v1 backport — pure output shed).
- **In-scope North Star**: NS1 (wrong→right), NS2, NS3.
- **Prohibitions**: as increment 01. packages/_parity/** is in
  footprint for register.json and corpus only — still NEVER edit
  packages/_parity/src/** (G2).

## Plan

## Task 03.1: implement prologue-aware directive handling

- [ ] **Step 1:** Locate v2 directive handling:
  `rg -n "use client|directive" packages/extract/crates/extract-v2/src/emit.rs packages/extract/crates/extract-v2/src/*.rs`.
  Identify the offset-0 check mirrored from v1.
- [ ] **Step 2:** Replace with directive-prologue detection: scan past
  leading whitespace/comments; a string-literal expression statement in
  prologue position is a directive; find the LAST directive's end;
  import injection point is after it. (If the v2 emitter works on the
  parsed AST, prefer the AST's directives list over manual scanning.)
- [ ] **Step 3:** `cargo test --lib` — green (add/extend a unit test
  covering comment-then-directive and blank-line-then-directive).
  Rebuild v2 binary.

## Task 03.2: license + gates

- [ ] **Step 1:** Flip register entry `parity/use-client-comment.tsx`
  → category intentional-correctness, status active, note: v2 honors
  the directive prologue and injects imports below the directive (shed
  2026-07-13, inc 03); v1 retains the offset-0 quirk until retirement.
  Check whether `use-client-blank-line.tsx` also diverges now and
  license it too if so.
- [ ] **Step 2:** `bash scripts/verify/parity.sh | tail -1` → PASS.
- [ ] **Step 3:** Consumer oracle for the affected surface:
  `vp run verify:next` — green.

## Guardrail gate

- [ ] G2 — result: <record>
- [ ] G3 — result: <record>
- [ ] G4 — result: <record>

## Output contract (delegated)

- [ ] Plan checkboxes ticked
- [ ] Diff summary; before/after emitted-header example for
      use-client-comment.tsx
- [ ] Gate results with excerpts
- [ ] Proposed journal entries — or none
- [ ] Surfaced variables — or none

## Spec authorship checklist (orchestrator)

- [ ] Envelope spec covers row
- [ ] Journal + tick row 03 `· ticked: <ts>`
