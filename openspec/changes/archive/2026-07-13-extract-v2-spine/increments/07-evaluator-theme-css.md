# Increment 07: evaluator-theme-css

## Scope

- **Registry row**: 07 · mode: inline · review: subagent
- **Resolves**: DEF-11 (evaluator reference path); unlocks the 6 gated
  transform surfaces, v2 CSS, full harness v1-vs-v2 rows, and the
  options struct (prefix/runtime — RF-53's named gaps)
- **Authors**: — (envelope `transform-evaluation-contract` +
  `extraction-parity-harness` cover the behavior)
- **Depends on (ordering — deps:)**: 06
- **Inputs from (information — inputs:)**: none
- **Footprint**: packages/extract/crates/extract-v2/**,
  packages/extract/index-v2.js, packages/_parity/**,
  openspec/changes/extract-v2-spine/**
- **Pushes to a later increment**: compose emission (own row); loadSystemModule
  port decision; cross-file extension MERGE emission (chain-merger port —
  gated loud since inc 06).

> Licensed by the DEF-11 half-signal entry (journal 2026-07-13 04:40):
> the G-SEAM battery is this row's ENTRY TASK (Task 07.1), completing the
> signal as the row begins.

## Context Capsule

- **Objective**: v2 evaluates user transforms and resolves themes/CSS
  bug-compatibly with v1's PRODUCTION path, unlocking: the 6
  config/merge-gated fixtures, v2 CSS output (arming the harness CSS
  class and full v1-vs-v2 scoreboard rows), and the engine options
  struct (prefix, runtime import, css module ids — replacing the RF-53
  hardcodes).
- **DEF-11 decision material**: v1 has TWO evaluator paths — QuickJS
  (rquickjs, production analyzeProject path: transform_evaluator.rs, a
  ~130-line wrapper; single shared context; globalThis registration;
  last-registration-wins across files; `String(fn(arg))` ToString
  semantics; value_to_js_literal escaping only \\ " \n — raw \r is an
  eval error SILENTLY swallowed at theme_resolver:602-614) and the TS
  placeholder path (extract() → __TRANSFORM__ placeholders →
  pipeline/resolve-transforms.ts, which COERCES numeric strings via
  Number()). Production = QuickJS; extract() has zero plugin consumers
  (DEF-1 grep). EXPECTED RESOLUTION: QuickJS is v2's reference; the
  placeholder path dies with extract() (canary adapter, if ever needed,
  goes through the engine).
- **Task order** (each gate-checked before the next):
  1. G-SEAM battery (tools/seam-battery.ts + committed baseline):
     recorded expectations from v1's QuickJS path for: string/number
     coercion; exponent thresholds (1e16, 1e21); scale keys "8.0" vs
     "8"; negation helper; throwing transforms; cross-file
     name collisions (last-registration-wins order); \r/exotic strings
     (document the silent-swallow); numeric formatting. Battery runs
     against ANY engine path; v1-recorded baseline committed.
  2. Evaluator port: rquickjs into the v2 crate (dependency addition —
     record dep-weight like DEF-2); port transform_evaluator semantics
     EXACTLY (shared context, registration, ToString, literal escaping);
     battery green against v2.
  3. Options struct: #[napi(object)] EngineOptions {prefix?,
     runtimeImport?, cssModuleId?, systemPropsModuleId?, themeJson?,
     configJson?, groupRegistryJson?, ...} on the ExtractEngine
     constructor — v1-default behavior when absent; RF-53 hardcodes
     replaced; code-parity gains a prefix'd run.
  4. Theme/scale resolution port (theme_resolver adaptation per D12 —
     resolve_styles consuming evaluated stage facts + theme; token
     aliases; contextual vars; the unresolvable-alias passthrough
     contract per the register's known-quirk entries).
  5. CSS generation port (css_generator adaptation: @layer structure,
     deterministic ordering — v1's sorts promoted to the output-ordering
     contract per the stall-mitigation in design.md §Risks).
  6. Unlock + gates: ungate system/props/config surfaces; extend
     code-parity expectations; arm harness CSS class + full v1-vs-v2
     runs (engine-run v2 adapter — RF-54); G-SEAM battery in the tier.
- **Bug-compat constraints**: D3 (all quirks per register; the
  unresolved-alias invalid-CSS passthrough is CONTRACT until post-flip);
  D12 (adaptation, not blind reuse); G1 (zero new parses — theme/CSS
  consume facts + theme JSON only); G2/G3/G5/G6/G7 as registered.
- **Prohibitions**: standard (no VCS; footprint; single-writer).

## Plan

## Task 07.1: G-SEAM battery
- [x] tools/seam-battery.ts + seam-baseline.json (14 cases, round-trip
      green). Key recorded contracts: dtoa exponent threshold (1e16 vs
      1e21), '8.0'-vs-'8' scale-key sensitivity, raw-\r silent
      passthrough, negative-scale negation, rem transforms. SCOPE
      REFINEMENT (journal 05:10): .props() transforms are RUNTIME-var
      emission semantics, not build-eval — build-time QuickJS is
      confined to config scale/group transforms, shrinking Task 07.2's
      surface. DEF-11 material complete: QuickJS = reference;
      TS-placeholder path dies with extract().
## Task 07.2: Evaluator port
- [x] rquickjs (bindgen) added; transform_evaluator ported VERBATIM —
      v1's 4 tests green (154 crate total). Battery-vs-v2 asserts arm at
      07.5 when the full pipeline exists.
## Task 07.3: Engine options struct
- [x] EngineOptions {prefix, runtimeImport, cssModuleId} with v1
      defaults; hardcodes replaced through analyze-time class identity +
      emission; default-path code-parity DIFFS=0 preserved. CAVEAT
      (journal 05:45): v1's analyzeProject arg-9 prefix is empirically
      INERT — v2 prefix parity is unpinned until v1's real plumbing is
      source-verified (reviewer material).
## Task 07.4: Theme/scale resolution
- [x] theme.rs — theme_resolver VERBATIM (1722 lines, 43 tests): resolve
      pipeline, shorthand-tier ordering, token aliases incl. raw
      passthrough contract, contextual vars, pseudo/selector merging.
      Fact-wiring rides with 07.6.
## Task 07.5: CSS generation
- [x] css.rs — css_generator VERBATIM (1984 lines, 28 tests): @layer
      sheets, deterministic ordering, utility/system CSS, keyframes,
      per-component fragments. camel_to_kebab inlined verbatim (first
      inline diverged on leading-uppercase — verbatim discipline caught
      it). Engine wiring rides with 07.6.
## Task 07.6: Unlock + arm
- [x] Full pipeline over facts: pipeline.rs (process_chain post-eval
      mirror), reconcile.rs + chain_merge.rs + transforms.rs (verbatim
      ports), analyze_css.rs (Phases 3-6 orchestration, zero re-parse),
      EngineOptions data inputs, evaluator registration, replacement
      payloads (system/props ungated), extension merged-config emission,
      compose emission (pulled forward from "own row" — the full
      scoreboard blocked on it). RESULTS: code-parity byte-equal=35/35
      needs-config=0; css-parity 27/27 all sheets; seam-battery 14/14
      both engines; full harness v1-vs-v2 BOTH dev modes: PASS, 0
      unregistered divergences (only both-engine known-quirk
      css-validity entries). 273 crate tests.

## Guardrail gate
- [x] G1 (zero new parses: usage scans are fact filters; only the tiny
      createTransform wrapper strip parses, uncounted + journaled);
      G-SEAM battery both engines; code-parity 35/35; chain-parity
      112/112; verify:parity extended to 3 legs (self-check + battery +
      v1-vs-v2 differential) — all green 2026-07-13.

## Output contract (inline mode)
- [x] Plan ticked; gates recorded; DEF-11 resolution recorded (QuickJS
      reference; placeholder path dies with extract()); journal entries
      06:55/07:55/post-arm; spawn candidates: flip-preconditions row;
      import-resolver re-export parity row (extension parents via
      re-export barrels are the journaled gap).

## Spec authorship checklist (orchestrator)
- [x] DEF-11 flipped (QuickJS reference); FULL reorientation journaled
      (09:05) + composed-CSS vacuity probe (09:15); two Fable reviewers
      (semantics + gate integrity) — 12 blocking findings fixed and
      re-verified (journal 10:20); row 07 ticked 2026-07-13 10:25.
