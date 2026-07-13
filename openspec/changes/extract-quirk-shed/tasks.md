# Tasks — extract-quirk-shed

## 1. Increment Registry

- [x] 01 [mode:inline · review:subagent] (signal: journal 2026-07-13 03:25 · ticked: 2026-07-13 03:50) — resolves: DEF-4 · authors: §deterministic-extraction/Emitted CSS is always parseable, §extraction-diagnostics/Unresolved-alias leaks are diagnosed · deps: — · inputs: change:extract-v2-default-flip#02 · footprint: packages/extract/crates/extract-v2/src/**, packages/_parity/register.json, packages/_parity/corpus/**, openspec/changes/extract-quirk-shed/**
- [x] 02 [mode:inline · review:self] (signal: journal 2026-07-13 03:25 · ticked: 2026-07-13 04:05) — resolves: — · authors: §extraction-diagnostics/Eval-failed chains are diagnosed · deps: 01 · inputs: — · footprint: packages/extract/crates/extract-v2/src/**, packages/_parity/register.json, openspec/changes/extract-quirk-shed/**
- [ ] 03 [mode:inline · review:subagent] (lazy — blocked on: DEF-4) — resolves: — · authors: §transform-evaluation-contract/Directive detection tolerates leading trivia · deps: 02 · inputs: — · footprint: packages/extract/crates/extract-v2/src/**, packages/_parity/**, openspec/changes/extract-quirk-shed/**
- [ ] 04 [mode:inline · review:subagent] (lazy — blocked on: DEF-4) — resolves: — · authors: §transform-evaluation-contract/Import emission derives from structured decisions · deps: 03 · inputs: — · footprint: packages/extract/crates/extract-v2/src/**, packages/_parity/**, openspec/changes/extract-quirk-shed/**
- [ ] 05 [mode:inline · review:self] (lazy — blocked on: DEF-1) — resolves: DEF-1 · authors: — · deps: — · inputs: — · footprint: packages/system/src/SystemBuilder.ts, packages/extract/crates/extract-v2/src/**, openspec/changes/extract-quirk-shed/**
- [ ] 06 [mode:inline · review:self] (lazy — blocked on: DEF-4) — resolves: — · authors: — · deps: — · inputs: — · footprint: packages/_parity/register.json, openspec/changes/extract-quirk-shed/**
- [ ] 07 [mode:inline · review:subagent] (lazy — blocked on: DEF-2) — resolves: DEF-2, DEF-3 · authors: §extraction-parity-harness/Divergence is licensed by registration, §extraction-parity-harness/Oracle inversion to committed baselines · deps: 01, 02, 03, 04, 05, 06 · inputs: — · footprint: packages/_parity/**, packages/extract/**, scripts/verify/**, openspec/changes/extract-quirk-shed/**
- [ ] 08 [mode:inline · review:self] (lazy — blocked on: DEF-5) — resolves: DEF-5 · authors: — (envelope extraction-diagnostics scenario 'Alias diagnostic surfaces in dev' is the contract) · deps: 01 · inputs: 01 · footprint: packages/vite-plugin/src/**, packages/next-plugin/src/**, openspec/changes/extract-quirk-shed/**

> Blast-radius order (design D2): 01 alias-leak diagnostics+valid CSS ·
> 02 eval-drop diagnostics · 03 'use client' trivia · 04 structured
> import decisions · 05 selectorOrder (resolves DEF-1 wire-vs-remove) ·
> 06 duplicate-compose register drop (zero code) · 07 oracle inversion +
> v1 retirement (resolves DEF-2 mechanics + DEF-3 loadSystemModule).
> Every row gated on the flip change's row 02 (G1: sheds ship as fixes).

## 2. Journal

See journal.md (created at first increment).
