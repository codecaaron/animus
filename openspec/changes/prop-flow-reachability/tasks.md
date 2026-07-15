# Tasks — prop-flow-reachability

## 1. Increment Registry

- [x] 01 [mode:inline · review:subagent] increments/01-residue-facts-histogram.md — resolves: D1, D2 · authors: §usage-residue-facts/Per-site dynamic usage records, §usage-residue-facts/Residue records are additive manifest data, §usage-residue-facts/Histogram derivability · deps: — · inputs: — · footprint: packages/extract/crates/extract-v2/**, openspec/changes/prop-flow-reachability/tools/** · ticked: 2026-07-13 21:06
- [x] 02 [mode:delegate · review:subagent] increments/02-witness-recorder.md — resolves: D4 · authors: §style-witness-recording/Dev-mode resolution witness buffer, §style-witness-recording/Documented retrieval handle, §style-witness-recording/Bounded buffer, §style-witness-recording/Production exclusion · deps: — · inputs: — · footprint: packages/system/src/runtime/**, packages/system/__tests__/** · ticked: 2026-07-13 21:11
- [x] 03 [mode:inline · review:subagent] increments/03-statics-enrichment.md — resolves: D3, D5 · authors: §jsx-system-prop-scanner/Static value evaluation, §shared-system-prop-map/Shared system prop map artifact · deps: 01 · inputs: external:extract-v2-engine-flip · footprint: packages/extract/crates/extract-v2/**, packages/_parity/** · ticked: 2026-07-13 21:51
- [x] 04 [mode:inline · review:subagent] (retired — journal 2026-07-15 14:44 EDT) — resolves: DEF-1 · authors: — · deps: 03 · inputs: 01 · footprint: packages/extract/crates/extract-v2/** · ticked: 2026-07-15 14:44 EDT
- [x] 05 [mode:inline · review:subagent-if-available] (retired — journal 2026-07-15 14:44 EDT) — resolves: DEF-2 · authors: — · deps: 03 · inputs: 01 · footprint: packages/vite-plugin/src/**, packages/next-plugin/src/** · ticked: 2026-07-15 14:44 EDT
- [x] 06 [mode:delegate · review:subagent] (retired — journal 2026-07-15 14:44 EDT) — resolves: DEF-3 · authors: — · deps: — · inputs: 01 · footprint: packages/system/src/** · ticked: 2026-07-15 14:44 EDT
- [x] 07 [mode:inline · review:subagent-if-available] (retired — journal 2026-07-15 14:44 EDT) — resolves: DEF-4 · authors: — · deps: 02 · inputs: 02 · footprint: packages/system/src/runtime/**, packages/vite-plugin/src/** · ticked: 2026-07-15 14:44 EDT
- [x] 08 [mode:delegate · review:subagent] (retired — journal 2026-07-13 21:06) — resolves: DEF-5 · authors: — · deps: 03 · inputs: 01 · footprint: packages/extract/crates/extract-v2/** · ticked: 2026-07-13 21:06

Registry notes:

- Rows 01 and 02 are envelope-licensed and inputs-free. Row 02's packet is authored in
  this envelope; row 01's packet is authored at apply start after a fresh read of
  `crates/extract-v2/src/{jsx_scan,usage_facts,facts,engine}.rs` (inline mode — the
  packet author and executor are the same session; the capsule must still pass the
  cold-start test).
- Row 01 is pre-flip safe (additive v2-native fields only; guardrail G2 gates it). Its
  histogram output over showcase + e2e manifests is the resolving-signal artifact for
  DEF-1, DEF-2, DEF-3, DEF-5.
- Row 03 MUST NOT be authored before the `external:extract-v2-engine-flip` journal
  `signal` entry exists; G1 (static-site invariance) is its gate.
- Rows 04–07 are retired from this delivered envelope into `followups.md`: increment 01
  did not measure wrapper depth, typed-resolvability, or annotation-resolvability, and
  showcase-dev witness stability was not observed. Their Ledger decisions remain
  deferred under external signal owners. Row 08 is retired because extra arm-join forms
  were zero in the corpus.
- Row 02 shares the dev-gating idiom with `change:total-dynamic-floor#01` (drop
  diagnostic); land in either order — no information edge, the shared idiom is
  convention, not a contract.

## 2. Cross-cutting

- G4 (v1 frozen) applies to every row.
- NS2 (additivity) is checked at every reorientation: corpus CSS byte-compare for
  already-static fixtures.
