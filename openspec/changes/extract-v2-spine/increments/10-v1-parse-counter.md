# Increment 10: v1-parse-counter

## Scope

- **Registry row**: 10 · mode: inline · review: self
- **Resolves**: — (mechanical instrumentation; supplies the empirical
  parse-count half of D1's evidence and activates the harness
  `--parse-count` budget reporting for v1)
- **Authors**: — (envelope `extraction-parity-harness` §Parse-count
  reporting covers the behavior)
- **Depends on (ordering — deps:)**: 02
- **Inputs from (information — inputs:)**: none
- **Footprint**: packages/extract/src/**, packages/\_parity/src/**,
  openspec/changes/extract-v2-spine/\*\*
- **Pushes to a later increment**: none

> Spawned at the inc-02 reorientation window (journal 2026-07-12 21:12);
> mechanical row, no DEF signal required.

## Context Capsule

- **Objective**: v1's `analyzeProject` manifest reports the number of
  `Parser::new` invocations performed during the build as
  `timing.parse_count` (additive field; `PipelineTiming` is OUTSIDE the
  parity byte surface by design.md D2), and the harness `--parse-count`
  mode consumes it (engine-run.ts already reads
  `manifest.timing?.parse_count`). Baselines.md gains empirical per-unit
  parse counts, replacing the analytic k+3 formula.
- **Mechanism**: a thread-safe counter (AtomicUsize) threaded through or
  global-per-call (reset at analyze start; rayon workers increment),
  incremented adjacent to every `Parser::new(...)` in the analyze path:
  project_analyzer phases, lib.rs `process_chain` stage re-parses,
  jsx_scanner/compose re-parses, system_loader (if invoked). extract()
  path may report via ExtractionResult later — out of scope here.
- **In-scope guardrails**: G3 control (count unchanged); tiers
  `verify:unit:rust && verify:canary && verify:integration`; G8 self-check
  stays green (timing excluded from surface — verify by running
  `bun run src/cli.ts --self-check` in packages/\_parity).
- **Prohibitions**: no version-control commands; no writes outside
  footprint + this file; never write design.md/tasks.md/journal.md/specs/.

## Plan

## Task 10.1: Counter

- [x] **Step 1:** `ANALYZE_PARSE_COUNT` static + `count_parse()` in
      project_analyzer.rs; reset at analyze() entry; emitted as
      `timing.parseCount` (PipelineTiming is serde-camelCase — caught after
      an unasserted replace repeated the RF-19 no-op class; fixed with
      asserts). Instrumented sites: project_analyzer ×3 (Phase-1, compose
      pre-scan, JSX scan), lib.rs process_chain ×2, transform_extractor ×1,
      chain_walker::walk_chains ×1 — test-module sites excluded by
      classification against each file's `mod tests` boundary.
- [~] **Step 2:** analyze()'s 15-arg signature makes a Rust-level unit
      test disproportionate; automated equivalent: the harness
      `--parse-count` mode now consumes v1's reported counts on every run,
      and the empirical table in baselines.md pins exact values (button=7,
      16 fixtures=119, showcase=496).
- [x] **Step 3:** Rebuilt; harness note gone (v1 reports); baselines.md
      records per-unit + showcase-scale counts: v1 8.0× per file at real
      scale vs v2's 1× by construction.

## Guardrail gate

- [x] G3 control — result: 10 (unchanged).
- [x] Tiers — result: unit:rust 280 · canary 197/0 fail · integration exit 0.
- [x] G8 self-check — result: PARITY GATE: PASS (timing excluded from the
      byte surface by D2, so the counter adds no nondeterminism).

## Output contract (inline mode — collapse into checklists above)

- [x] Plan ticked; gate results recorded; journal: reorientation below;
      surfaced variables: none (concurrent-analyze best-effort caveat
      documented on the field itself)

## Spec authorship checklist (orchestrator)

- [ ] Off-beat reorientation (entropy auditor only); tick row 10
