# Increment 01: alias-leak

## Scope

- **Registry row**: 01 · mode: inline (delegated — journal mode-change
  2026-07-13 03:25) · review: subagent
- **Resolves**: DEF-4 (start gate — flips to resolved at this row's
  tick; signal already journaled 03:25)
- **Authors**: §deterministic-extraction/Emitted CSS is always
  parseable, §extraction-diagnostics/Unresolved-alias leaks are
  diagnosed — both already authored at propose (envelope).
- **Depends on (deps:)**: none
- **Inputs from (inputs:)**: change:extract-v2-default-flip#02 — ticked
  2026-07-13 03:20 (v2 is the shipped default; G1 probe prints v2).
- **Footprint**: packages/extract/crates/extract-v2/src/**,
  packages/_parity/register.json, packages/_parity/corpus/**,
  openspec/changes/extract-quirk-shed/**
- **Pushes to a later increment**: none

## Context Capsule

- **Objective**: An unresolvable token alias (`{scale.path}` absent
  from theme + variable map) no longer leaks raw into emitted CSS. The
  v2 engine drops the carrying declaration and emits a warn diagnostic
  naming component, property, and the unresolved alias. The four
  css-validity register entries flip to licensed intentional
  divergence; the parity gate stays PASS with 0 unregistered.
- **In-scope guardrails** (design.md Register; STOP severity):
  - G2: SHALL NOT modify harness comparison code — check:
    `git status --short packages/_parity/src/compare.ts packages/_parity/src/scoreboard.ts` → empty
  - G3: SHALL NOT leave an unregistered divergence — check:
    `bash scripts/verify/parity.sh | tail -1` → `PARITY GATE: PASS`
  - G4: SHALL NOT remove v1 — check:
    `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs`
- **Requirements being implemented** (verbatim targets):
  - deterministic-extraction: "An unresolvable token alias SHALL NOT
    pass through as a raw `{scale.path}` literal; the carrying
    declaration SHALL be dropped or replaced with a diagnosed
    fallback." Scenario: sheets parse cleanly under the harness
    css-validity check; diagnostic identifies component, property,
    unresolved alias.
  - extraction-diagnostics: unresolvable alias → warn diagnostic with
    file and property context, surfaced through the plugin diagnostics
    channel in dev.
- **Relevant resolved decisions**: D1 (divergence by registration —
  flip register entries, never touch compare.ts); D3 (no v1 backport:
  diagnostics are additive; v1 is oracle-only).
- **Known witnesses** (from register.json, all `known-quirk` +
  css-validity, status active): `extract/contextual-vars.tsx`
  ({colors.current-bg}), `extract-all` (aggregated), 
  `extract/token-alias.tsx` ({colors.nonexistent}, dev-mode only),
  `integration/selector-rules` ({colors.does-not-exist.999}, both
  modes).
- **In-scope North Star**: NS1 (silent→loud AND wrong→right); NS2 (0
  unregistered); NS3 (diagnostic is the spec'd contract above).
- **Prohibitions**: no VCS mutations; no writes outside the footprint;
  NEVER write design.md, tasks.md, journal.md, or specs/** — return
  proposed entries in the output contract; do NOT touch
  packages/_parity/src/** or v1 (packages/extract/src/**).

## Plan

## Task 01.1: discover the leak site and diagnostics channel

- [x] **Step 1:** Locate v2 alias resolution: `rg -n 'scale|alias|\{.*\}' packages/extract/crates/extract-v2/src/theme.rs | head -30`
  and `rg -n 'resolve' packages/extract/crates/extract-v2/src/{theme,css,analyze_css}.rs`.
  Identify where a `{path}` lookup misses and the raw literal continues
  into declaration emission.
- [x] **Step 2:** Locate the v2 manifest diagnostics channel:
  `rg -n 'diagnostic|warn|bail' packages/extract/crates/extract-v2/src/{engine,analyze_css,pipeline}.rs | head -20`.
  Record the existing diagnostic struct/shape (must reuse it, not
  invent a parallel one).
- [x] **Step 3:** Read `packages/_parity/src/register.ts` and
  `compare.ts` enough to answer: how does an entry license a
  divergence (unit/artifact matching), and what statuses/categories the
  code recognizes. Do not modify them.

## Task 01.2: implement drop + warn

- [x] **Step 1:** At the miss site, replace raw passthrough with:
  drop the carrying declaration; push a warn diagnostic containing
  component name, CSS property, and the unresolved alias text.
- [x] **Step 2:** `cargo test --lib` in
  `packages/extract/crates/extract-v2` — green.
- [x] **Step 3:** Rebuild the v2 binary: `vp run build:extract-v2` (or
  `cd packages/extract/crates/extract-v2 && bunx napi build --platform --release`).

## Task 01.3: register flips + parity

- [x] **Step 1:** In `packages/_parity/register.json`, flip the four
  css-validity entries (`extract/contextual-vars.tsx`, `extract-all`
  css-validity, `extract/token-alias.tsx`, `integration/selector-rules`)
  to `category: intentional-correctness`, status active, note updated:
  v2 drops the declaration and emits the warn diagnostic (shed
  2026-07-13, extract-quirk-shed inc 01); v1 retains raw passthrough
  until retirement. Add/adjust any entry the css/code artifact
  comparison now needs for these units (v2 CSS no longer contains the
  bad declaration ⇒ css artifact diverges from v1 — must be licensed).
  (Licensed css + observables + diagnostics per unit; code stays
  unlicensed — class names are filename::binding hashes, unaffected.)
- [x] **Step 2:** `bash scripts/verify/parity.sh | tail -1` →
  `PARITY GATE: PASS` (0 unregistered).
- [x] **Step 3:** Consumer oracles: `vp run verify:vite && vp run verify:next && vp run verify:showcase`
  — green (consumer fixtures have no unresolvable aliases; expect
  byte-identical output).
  (Confirmed byte-identical: vite `index-D1eW6TMN.css`
  md5 06286e8452bf9a4f70c6ba9521151ba1, showcase `styles-CBAIGhXO.css`
  md5 2121f8cd31d0d6b67b83cba7a864a057, next `ade7869ad9d2d22c.css`
  md5 d5d3e9f40c6bf7c5424ef8a193e0e070 — unchanged pre/post shed.)

## Guardrail gate

- [x] G2: compare.ts/scoreboard.ts untouched — result: PASS —
  `git status --short packages/_parity/src/compare.ts packages/_parity/src/scoreboard.ts`
  → empty output (2026-07-13)
- [x] G3: `PARITY GATE: PASS` — result: PASS — final line of
  `bash scripts/verify/parity.sh` is `PARITY GATE: PASS`; both dev
  modes report `(0 unregistered)`; all v2-side css-validity rows gone
  (only `engine a:` v1 rows remain, licensed intentional-correctness)
- [x] G4: v1 present — result: PASS —
  `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs`
  → exit 0

## Output contract (delegated)

- [x] Plan checkboxes ticked to reflect actual completion
- [x] Exact diff summary (files + what changed)
- [x] Guardrail gate results with output excerpts
- [x] The diagnostic's exact emitted shape (JSON) for spec tie-back
- [x] Proposed journal entries (surprise/friction), 1-3 lines each
- [x] Surfaced variables (spawn candidates) — or none

## Spec authorship checklist (orchestrator)

- [ ] Envelope specs cover this row — verify diagnostic shape matches
      the scenario text
- [ ] Flip DEF-4 → resolved in design.md
- [ ] Journal entries appended; reorientation per cadence
- [ ] Tick registry row 01 with `· ticked: <ts>`
