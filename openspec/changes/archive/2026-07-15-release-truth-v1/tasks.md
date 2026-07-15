<!--
Increment Registry for release-truth-v1. Row grammar and field semantics per
the ooda schema; this file is the single owner of decomposition state.
Numbering is load-bearing: design.md guardrail Status fields (armed(inc NN))
and DEF-1's resolving signal cite these row numbers.
-->

## 1. Increments

- [x] 01 [mode:delegate · review:subagent] increments/01-ci-consumer-lanes.md — resolves: D1 · authors: — · deps: — · inputs: — · footprint: .github/workflows/ci.yaml · ticked: 2026-07-14 20:29
- [x] 02 [mode:inline · review:subagent] increments/02-packed-lane.md — resolves: D2,D4 · authors: — · deps: — · inputs: — · footprint: e2e/packed-app/\*\*, vite.config.ts, scripts/verify/\*\*, package.json · ticked: 2026-07-14 21:41
- [x] 03 [mode:delegate · review:subagent] increments/03-release-gate-flip.md — resolves: D1 · authors: — · deps: 01,02 · inputs: — · footprint: .github/workflows/ci.yaml · ticked: 2026-07-14 22:13
- [x] 04 [mode:delegate · review:subagent] increments/04-peer-clamps.md — resolves: D3 · authors: — · deps: — · inputs: — · footprint: packages/vite-plugin/package.json, packages/next-plugin/package.json · ticked: 2026-07-14 21:56
- [x] 05 [mode:delegate · review:subagent] increments/05-claude-md-ownership.md — resolves: D5 · authors: — · deps: 02 · inputs: — · footprint: CLAUDE.md · ticked: 2026-07-14 21:56
- [x] 06 [mode:delegate · review:subagent] increments/06-lane-receipts.md — resolves: D4 · authors: — · deps: 02 · inputs: — · footprint: packages/_assertions/\*\*, scripts/verify/\*\*, e2e/next-app/scripts/\*\*, e2e/vite-app/scripts/\*\*, scripts/assert-showcase-build.ts (corrected from packages/showcase/scripts/\*\* — footprint drift, see journal) · ticked: 2026-07-14 22:13
- [x] 07 [mode:delegate · review:subagent] increments/07-publish-manifest-hygiene.md — resolves: D7 · authors: — · deps: — · inputs: — · footprint: packages/properties/package.json, packages/system/package.json, packages/extract/package.json, packages/vite-plugin/package.json, packages/next-plugin/package.json, packages/\*/tsdown.config.\*, packages/extract/index-v2.d.ts, scripts/verify/_preconditions.sh · ticked: 2026-07-14 21:41

## 2. Cross-cutting

- [x] 2.1 release-notes callout for the peer-range clamps (consumer-visible manifest change; rides with the first release cut after increment 04 lands) — done: CHANGELOG.md Unreleased section covers the clamps + inc 07 packaging fixes (2026-07-14)
