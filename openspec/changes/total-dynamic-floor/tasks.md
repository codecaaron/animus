# Tasks — total-dynamic-floor

## 1. Increment Registry

- [x] 01 [mode:delegate · review:subagent] increments/01-runtime-drop-diagnostic.md — resolves: D2, D4 · authors: §dynamic-prop-fallback/Runtime drop diagnostic · deps: — · inputs: — · footprint: packages/system/src/runtime/**, packages/system/__tests__/** — completed 2026-07-13 20:53
- [x] 02 [mode:inline · review:subagent] increments/02-total-floor-emission.md — resolves: D1, D3 · authors: §dynamic-prop-fallback/Total system prop floor, §dynamic-prop-fallback/Custom prop lazy generation · deps: 01 · inputs: external:extract-v2-engine-flip · footprint: packages/extract/crates/extract-v2/**, packages/_parity/**, openspec/changes/total-dynamic-floor/** — completed 2026-07-13 21:19
- [x] 03 [mode:inline · review:subagent] increments/03-reachable-floor-narrowing.md — resolves: DEF-1, DEF-3 · authors: §dynamic-prop-fallback/Total system prop floor · deps: 02 · inputs: 02 · footprint: packages/extract/crates/extract-v2/**, packages/_parity/**, openspec/changes/total-dynamic-floor/** — completed 2026-07-13 21:46
- [ ] 04 [mode:delegate · review:subagent] (lazy — blocked on: DEF-2) — resolves: DEF-2 · authors: — · deps: 01 · inputs: 01 · footprint: packages/system/src/runtime/**, packages/system/__tests__/**

Registry notes:

- Row 01 is engine-agnostic (runtime TS only; no CSS or manifest delta) and may land
  immediately; verification per Change-Type Map row `packages/system/src/**`.
- Row 02 MUST NOT start before the `external:extract-v2-engine-flip` journal `signal`
  entry exists (G4 stays active regardless). Its packet includes the byte-delta
  measurement whose output is the resolving signal for DEF-1/DEF-3 (row 03).
- Row 03 is licensed by the row-02 measurement: custom props remain lazy and the system
  floor narrows to reconciliation-retained components with conservative widening. Row 04
  finalizes diagnostic escalation policy after dogfooding row 01.

## 2. Cross-cutting

- G4 (v1 frozen) applies to every row; its check runs in each increment's verify step.
