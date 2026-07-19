# Tasks — formalize-style-verification

## 1. Increments

- [ ] 01 [mode:inline · review:subagent-if-available] increments/01-verdict-contract.md — resolves: D1 · authors: — · deps: — · inputs: — · footprint: packages/_verify/src/contract/**
- [ ] 02 [mode:delegate · review:subagent] increments/02-callsite-spread-facts.md — resolves: D4 · authors: — · deps: — · inputs: — · footprint: packages/extract/crates/extract-v2/**
- [ ] 03 [mode:inline · review:subagent] increments/03-session-core.md — resolves: D2,D3,D10 · authors: — · deps: 01,02 · inputs: — · footprint: packages/_verify/src/session/**
- [ ] 04 [mode:delegate · review:subagent] increments/04-cli-mcp-surfaces.md — resolves: D7 · authors: — · deps: 03 · inputs: — · footprint: packages/_verify/src/cli/**, packages/_verify/src/mcp/**, vite.config.ts, AGENTS.md
- [ ] 05 [mode:inline · review:subagent] increments/05-universe-diff-governance.md — resolves: — · authors: — · deps: 03 · inputs: — · footprint: packages/_verify/src/diff/**
- [ ] 06 [mode:delegate · review:subagent] increments/06-witness-envelope.md — resolves: — · authors: — · deps: — · inputs: — · footprint: packages/system/src/runtime/**
- [ ] 07 [mode:delegate · review:subagent] increments/07-ci-governance-wiring.md — resolves: — · authors: — · deps: 05 · inputs: — · footprint: .github/workflows/**
- [ ] 08 [mode:inline · review:subagent-if-available] increments/08-patch-ir-speculation.md — resolves: D5 · authors: — · deps: 03,05 · inputs: — · footprint: packages/_verify/src/patch/**, packages/_verify/src/select/**
- [ ] 09 [mode:inline · review:subagent] (lazy — blocked on: DEF-7) — resolves: DEF-7,D6 · authors: §universe-snapshot-ledger/Snapshot normalization · deps: 07 · inputs: — · footprint: packages/_verify/src/ledger/**, .github/workflows/**
- [ ] 10 [mode:delegate · review:subagent] increments/10-style-bisect.md — resolves: — · authors: — · deps: 09 · inputs: — · footprint: packages/_verify/src/bisect/**
- [ ] 11 [mode:inline · review:subagent-if-available] increments/11-inverse-solver-v1.md — resolves: — · authors: — · deps: 03 · inputs: — · footprint: packages/_verify/src/solver/**
- [ ] 12 [mode:inline · review:subagent-if-available] (lazy — blocked on: DEF-6) — resolves: DEF-6 · authors: — · deps: 08 · inputs: — · footprint: packages/_verify/**
- [ ] 13 [mode:inline · review:subagent-if-available] (lazy — blocked on: DEF-1) — resolves: DEF-1 · authors: — · deps: 03 · inputs: — · footprint: packages/_verify/src/types-oracle/**

## 2. Cross-cutting

- [ ] 2.1 gate:ops opx workspace initialization by maintainer (`opx ensure --init --repo … --grouping …`) — resolves: DEF-10
- [ ] 2.2 gate:ops coordination with the drafted total-dynamic-floor change (spread survival complement) — resolves: DEF-11 · inputs: external:total-dynamic-floor-landed
