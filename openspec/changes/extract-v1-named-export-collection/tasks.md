## 1. Increments

- [x] 01 [mode:delegate · review:subagent] increments/01-extract-named-export-collection.md — resolves: D1,D2,D3,D4,D5 · authors: — · deps: — · inputs: — · footprint: packages/extract/src/import_resolver.rs · ticked: 2026-07-19 13:46
- [ ] 02 [mode:inline · review:subagent] (lazy — blocked on: DEF-1) — resolves: DEF-1 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/import_resolver.rs
- [ ] 03 [mode:delegate · review:subagent] increments/03-extract-import-default-branches.md — resolves: D9,D10,D11,DEF-2 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/import_resolver.rs
- [x] 04 [mode:delegate · review:subagent] increments/04-normalize-declaration-export-construction.md — resolves: D6,D7,D8,DEF-3 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/import_resolver.rs · ticked: 2026-07-19 14:26
- [ ] 05 [mode:inline · review:subagent] (lazy — blocked on: DEF-4) — resolves: DEF-4 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/import_resolver.rs,packages/extract/src/project_analyzer.rs
- [ ] 06 [mode:inline · review:subagent] (lazy — blocked on: DEF-5) — resolves: DEF-5 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/**,packages/extract/crates/extract-v2/src/**
- [ ] 07 [mode:inline · review:subagent] (lazy — blocked on: DEF-6) — resolves: DEF-6 · authors: — · deps: 01 · inputs: — · footprint: packages/extract/src/import_resolver.rs

## 2. Cross-cutting

Rows 01 and 04 are complete. Row 03 is the sole active follow-on and combines
both remaining inline `parse_module_info()` branches—imports and default
exports—under one same-file packet. Rows 02 and 05–07 remain signal-blocked and
packetless. Completing row 03 SHALL NOT create epic-level
`verify.md`/`retrospective.md` or trigger archive.
