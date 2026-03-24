## Why

The extraction pipeline (Rust NAPI → Vite plugin → CSS output) is a black box. When components silently disappear from production CSS — as StratumRow did — there is no way to diagnose why without writing throwaway scripts. The manifest already contains reconciliation reports and usage ledgers, but the Vite plugin never surfaces this data. Every extraction debugging session starts from zero.

## What Changes

- Add structured verbose logging to the Vite plugin, controlled by `ANIMUS_DEBUG=1` env var or `verbose: true` plugin option
- Surface reconciliation elimination warnings **always** (not just in verbose mode) — silent component elimination is the most dangerous failure mode
- Add phase-level timing in verbose mode for performance investigation
- All output is grep-friendly with `[animus]` prefix

## Capabilities

### New Capabilities
- `extraction-diagnostics`: Structured logging across all plugin lifecycle phases (buildStart, transform, HMR) with reconciliation report surfacing and phase timing

### Modified Capabilities

## Impact

- `packages/vite-plugin/src/index.ts` — primary change site: verbose flag, logging at each lifecycle phase, reconciliation report parsing
- `packages/vite-plugin/CLAUDE.md` — document verbose mode and env var
- Plugin options type (`AnimusExtractOptions`) gains optional `verbose` field
- No new dependencies, no breaking changes, no effect on non-verbose output
