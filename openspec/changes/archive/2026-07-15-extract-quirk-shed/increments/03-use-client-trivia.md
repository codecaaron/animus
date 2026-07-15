# Increment 03: use-client-trivia

## Scope

- **Registry row**: 03 · mode: delegate (reorientation mode-change
  2026-07-13 15:41) · review: subagent
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

- [x] **Step 1:** Locate v2 directive handling:
  `rg -n "use client|directive" packages/extract/crates/extract-v2/src/emit.rs packages/extract/crates/extract-v2/src/*.rs`.
  Identify the offset-0 check mirrored from v1.
  (Checkpoint evidence: the committed `HEAD` (`199c27a`) already
  contains the shed in `assemble.rs`; v1 still uses the offset-0
  `result.starts_with(...)` check in `transform_emitter.rs`.)
- [x] **Step 2:** Replace with directive-prologue detection: scan past
  leading whitespace/comments; a string-literal expression statement in
  prologue position is a directive; find the LAST directive's end;
  import injection point is after it. (If the v2 emitter works on the
  parsed AST, prefer the AST's directives list over manual scanning.)
  (Spec-review RED: three isolated end-to-end engine tests each failed
  with exit 101 under the committed hand scanner: BOM/all Unicode Zs +
  U+2028/U+2029 put imports above the directive; a post-literal block
  comment before `;` put imports above the directive; and a newline
  `.length` continuation had imports inserted inside the expression.
  GREEN: fact extraction now retains OXC `Program.directives` as an
  internal `serde(skip)` `{last end, has_use_client}` fact. Both emitter
  paths consume that parsed boundary; no reparse or manifest change.
  Code-quality review RED 1: stripping an import-looking line inside a
  leading block comment shortened the post-strip source while leaving
  OXC's original directive offset unchanged, so imports landed inside
  generated component code. GREEN: replay the unchanged v1-compatible
  line strip over only the parsed prologue prefix and use its resulting
  length as the remapped offset. Code-quality review RED 2: ASI block
  and line comments plus an explicit-semicolon trailing block comment
  were split from the directive by injected imports. GREEN: after OXC
  classifies the directive and supplies its statement end, extend only
  that boundary through ECMAScript same-line whitespace/comments. OXC
  remains the sole directive/ASI classification authority.
  Code-quality re-review RED 3: when the legacy strip removed an
  import-shaped line that also held a block-comment `*/`, imports landed
  inside the now-unterminated comment; when that line also held the
  directive, the deleted directive's fact was retained as well. Both
  isolated end-to-end tests failed with exit 101. GREEN: the unchanged
  v1 strip loop now reports original removal ranges. OXC directive spans
  plus OXC comment-delimiter spans protect the lexical structure: any
  intersecting removal clears the prologue fact, while content-only
  comment-line removals remap by their removed byte count. No project
  reparse or directive classification was added. A separate RED/GREEN
  unit rejects out-of-source removal metadata, and remapping no longer
  slices at a numeric directive offset.)
- [x] **Step 3:** `cargo test --lib` — green (add/extend a unit test
  covering comment-then-directive and blank-line-then-directive).
  Rebuild v2 binary.
  (Fresh evidence 2026-07-13: all ten new focused tests passed,
  including nine end-to-end directive cases, the non-directive `.length`
  control among them, and the bounds-metadata unit; full suite 297
  passed, 0 failed; `vp run build:extract-v2`
  exited 0.)

## Task 03.2: license + gates

- [x] **Step 1:** Flip register entry `parity/use-client-comment.tsx`
  → category intentional-correctness, status active, note: v2 honors
  the directive prologue and injects imports below the directive (shed
  2026-07-13, inc 03); v1 retains the offset-0 quirk until retirement.
  Check whether `use-client-blank-line.tsx` also diverges now and
  license it too if so.
  (Register flip and the family expectation were already committed at
  task start. Direct engine runs show `use-client-blank-line.tsx` is
  byte-identical across v1/v2, so no second license is required.)
- [x] **Step 2:** `bash scripts/verify/parity.sh | tail -1` → PASS.
  (Fresh full gate: 22/26 divergences for prod/dev, 0 unregistered;
  final line `PARITY GATE: PASS`.)
- [x] **Step 3:** Consumer oracle for the affected surface:
  `vp run verify:next` — green.
  (Next production build compiled successfully; App + Pages router
  assertions all passed; `verify:next complete`.)

## Guardrail gate

- [x] G2 — result: PASS —
  `git status --short packages/_parity/src/compare.ts packages/_parity/src/scoreboard.ts`
  → empty output (2026-07-13)
- [x] G3 — result: PASS — full differential reports 22 divergences
  (prod) / 26 (dev), both with `0 unregistered`; final line is
  `PARITY GATE: PASS`
- [x] G4 — result: PASS —
  `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs`
  → exit 0

## Output contract (delegated)

- [x] Plan checkboxes ticked
- [x] Diff summary; before/after emitted-header example for
      use-client-comment.tsx
- [x] Gate results with excerpts
- [x] Proposed journal entries — accepted spec-review objection, three
      accepted code-quality-review objections, plus one harness-reporting
      friction entry returned to the orchestrator; not written here
- [x] Surfaced variables — none beyond that bounded row-07 harness
      reporting candidate

## Spec authorship checklist (orchestrator)

- [x] Envelope spec covers row
- [x] Journal + tick row 03 `· ticked: 2026-07-13 15:41`
