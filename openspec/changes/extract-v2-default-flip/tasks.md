# Tasks — extract-v2-default-flip

## 1. Increment Registry

- [x] 01 [mode:inline · review:subagent] (signal: journal 2026-07-13 02:59) — resolves: — · authors: §engine-release-packaging/Published package carries both engine binaries, §engine-release-packaging/Missing engine binaries fail loud, §dual-engine-build/Release builds produce both engine binaries · deps: — · inputs: external:release-window · footprint: packages/extract/package.json, packages/extract/index-v2.js, .github/workflows/**, scripts/verify/**, openspec/changes/extract-v2-default-flip/**
- [x] 02 [mode:inline · review:subagent] (signal: journal 2026-07-13 02:59 · ticked: 2026-07-13 03:20) — resolves: DEF-1, DEF-3 · authors: §vite-extraction-plugin/v2 is the default extraction engine, §next-config-wrapper/v2 is the default extraction engine · deps: 01 · inputs: 01 · footprint: packages/vite-plugin/src/**, packages/next-plugin/src/**, e2e/**, packages/showcase/vite.config.ts, openspec/changes/extract-v2-default-flip/**
- [x] 03 [mode:inline · review:self] (signal: journal 2026-07-13 03:20 · ticked: 2026-07-13 03:29) — resolves: — · authors: — · deps: 02 · inputs: 02 · footprint: packages/extract/index-v2.js, openspec/changes/archive/2026-07-13-extract-v2-spine/tools/**, openspec/changes/extract-v2-default-flip/**

> Row 01 = ship both binaries (postpack smoke G3 is the gate). Row 02 =
> flip defaults + fixtures + resolve DEF-1 (A3 residue) in review. Row 03
> = scaffolding retirement (Proxy simplification, archived-tool pointer
> cleanup) — blocked on DEF-1 because the Proxy's fate depends on the A3
> decision. `external:release-window` = the user schedules the release
> that ships-and-flips (D1: one event).

## 2. Journal

See journal.md (created at first increment).
