## 1. Increments

- [x] 01 [mode:delegate · review:subagent] increments/01-extract-scale-lookup.md — resolves: D1,D2,D3,D4 · authors: — · deps: — · inputs: — · footprint: packages/extract/src/theme_resolver.rs · ticked: 2026-07-19 13:12
- [ ] 02 [mode:inline · review:subagent] (lazy — blocked on: DEF-1) — resolves: DEF-1 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/theme_resolver.rs
- [ ] 03 [mode:inline · review:subagent] (lazy — blocked on: DEF-2) — resolves: DEF-2 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/theme_resolver.rs
- [ ] 04 [mode:inline · review:subagent] (lazy — blocked on: DEF-3) — resolves: DEF-3 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/theme_resolver.rs
- [ ] 05 [mode:inline · review:subagent] (lazy — blocked on: DEF-4) — resolves: DEF-4 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/theme_resolver.rs
- [ ] 06 [mode:inline · review:subagent] (lazy — blocked on: DEF-5) — resolves: DEF-5 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/**
- [ ] 07 [mode:inline · review:subagent] (lazy — blocked on: DEF-6) — resolves: DEF-6 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/**
- [ ] 08 [mode:inline · review:subagent] (lazy — blocked on: DEF-7) — resolves: DEF-7 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/**

## 2. Cross-cutting

Rows 02-08 are named carry-forward owners only. Their exact Ledger signals have
not appeared, no packet exists, and they do not block archive of the completed
private V1 scale-lookup extraction. Former packetless row 09 was removed when
later causal evidence retired DEF-8 as an execution-wrapper false positive.
