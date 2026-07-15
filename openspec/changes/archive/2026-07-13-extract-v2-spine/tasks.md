# Tasks — extract-v2-spine

## 1. Increment Registry

- [x] 01 [mode:inline · review:subagent] increments/01-v1-determinism-baseline.md — resolves: D10 · authors: — · deps: — · inputs: — · footprint: packages/extract/src/transform_emitter.rs, packages/extract/src/lib.rs, packages/extract/tests/**, openspec/changes/extract-v2-spine/** · ticked: 2026-07-12 20:40
- [x] 02 [mode:inline · review:subagent] increments/02-parity-harness-corpus.md — resolves: DEF-9 · authors: — · deps: 01 · inputs: — · footprint: packages/\_parity/**, package.json, bun.lock, packages/extract/src/project_analyzer.rs (one-field D10-class deviation, journal 21:46), openspec/changes/extract-v2-spine/** · ticked: 2026-07-12 21:48
- [x] 03 [mode:inline · review:subagent] increments/03-dual-build-mechanics.md — resolves: DEF-10 · authors: §arch-extract-v2-spine/Fact-only manifest, §arch-extract-v2-spine/No raw string surgery, §arch-extract-v2-spine/V1 isolation, §arch-extract-v2-spine/Umbrella dependency surface, §arch-extract-v2-spine/Construction and ownership containment · deps: 02 · inputs: — · footprint: packages/extract/**, packages/vite-plugin/src/**, packages/next-plugin/src/\*\*, vite.config.ts, CLAUDE.md, .github/workflows/ci.yaml · ticked: 2026-07-12 22:22
- [x] 04 [mode:inline · review:subagent] increments/04-v2-skeleton-chain-walker.md — resolves: D4 · authors: — · deps: 03 · inputs: — · footprint: packages/extract/\*\* (v2 tree per DEF-10 layout) · ticked: 2026-07-12 23:07
- [x] 05 [mode:inline · review:subagent-if-available] increments/05-emission-mechanism.md — resolves: DEF-2 · authors: — · deps: 04 · inputs: — · footprint: packages/extract/crates/extract-v2/**, openspec/changes/extract-v2-spine/** · ticked: 2026-07-13 02:12
- [x] 06 [mode:inline · review:subagent] increments/06-v2-napi-handle.md — resolves: DEF-1, DEF-5 · authors: — · deps: 04 · inputs: 02 · footprint: packages/extract/crates/extract-v2/**, packages/extract/index-v2.js, packages/_parity/src/**, openspec/changes/extract-v2-spine/** · ticked: 2026-07-13 04:32
- [x] 07 [mode:inline · review:subagent] increments/07-evaluator-theme-css.md — resolves: DEF-11 · authors: — · deps: 06 · inputs: — · footprint: packages/extract/crates/extract-v2/**, packages/extract/index-v2.js, packages/_parity/**, openspec/changes/extract-v2-spine/**, scripts/verify/parity.sh, vite.config.ts · ticked: 2026-07-13 10:25
- [x] 08 [mode:inline · review:subagent] (retired — journal 2026-07-13 13:30) — resolves: DEF-7 · authors: — · deps: 06 · inputs: 06 · footprint: packages/extract/**, packages/vite-plugin/src/**, packages/next-plugin/src/\*\* · ticked: 2026-07-13 13:30
- [x] 09 [mode:inline · review:self] increments/09-manifest-consumer-determinism.md — resolves: — · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/project_analyzer.rs, packages/extract/tests/**, openspec/changes/extract-v2-spine/** · ticked: 2026-07-12 20:53

- [x] 10 [mode:inline · review:self] increments/10-v1-parse-counter.md — resolves: — · authors: — · deps: 02 · inputs: — · footprint: packages/extract/src/**, packages/\_parity/src/**, openspec/changes/extract-v2-spine/\*\* · ticked: 2026-07-12 23:20

- [x] 11 [mode:inline · review:subagent] increments/11-v2-stage-evaluation.md — resolves: DEF-4 · authors: — · deps: 04 · inputs: — · footprint: packages/extract/crates/extract-v2/**, packages/_parity/**, openspec/changes/extract-v2-spine/** · ticked: 2026-07-13 01:25

- [x] 12 [mode:inline · review:self] (retired — journal 2026-07-13 18:05) — resolves: — · authors: — · deps: 11 · inputs: external:v2-tree-committed · footprint: packages/extract/crates/extract-v2/**, openspec/changes/extract-v2-spine/** · ticked: 2026-07-13 18:05
- [x] 13 [mode:inline · review:subagent] increments/13-flip-preconditions.md — resolves: DEF-7 · authors: — · deps: 07 · inputs: 07 · footprint: packages/extract/crates/extract-v2/**, packages/extract/index-v2.js, packages/vite-plugin/src/**, packages/next-plugin/src/**, packages/_parity/**, scripts/verify/**, openspec/changes/extract-v2-spine/** · ticked: 2026-07-13 17:15

Registry notes:

- Remaining spine-module ports (project analysis phases, JSX scanning,
  system loading, generator/reconciler adaptation per design.md D12) are
  deliberately NOT pre-planned; they spawn at reorientation checkpoints as
  row 04 lands and the harness scoreboard identifies the next seam. Each
  spawn gets a journal `spawn` entry.
- The symbol-correct-resolution increment is post-flip by design (design.md
  D3) and is gated by G9; it will be spawned only after the flip
  preconditions in design.md §Migration Plan are met.
- Rows 05-08 keep full field sets so the lint can check token integrity
  while lazy.

## 2. Cross-cutting

- None registered. No `gate:ops` work identified — the change is entirely
  in-repo (build, verify, and plugin surfaces); deployment is the
  consumer-side engine flip documented in design.md §Migration Plan.
