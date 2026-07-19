# Increment 02: callsite-spread-facts

## Scope

- **Registry row**: 02 · mode: delegate · review: subagent
- **Resolves**: D4 (additive verdict-prerequisite facts)
- **Authors**: — (envelope: `specs/callsite-provenance-facts/spec.md`)
- **Depends on (deps:)**: none
- **Inputs from (inputs:)**: none
- **Footprint**: `packages/extract/crates/extract-v2/**`

## Context Capsule

Read first: `specs/callsite-provenance-facts/spec.md` (three requirements:
static callsite records, spread markers, additive emission) and `design.md`
§D4, §G3.

Repo facts:
- JSX scanning lives in `packages/extract/crates/extract-v2/src/jsx_scan.rs`.
  Locate the spread arm via `rg -n "SpreadAttribute" packages/extract/crates/extract-v2/src/`
  — it is currently an empty match arm (spreads are skipped entirely).
- `SystemPropUsage` in `jsx_scan.rs` carries a `binding` field marked
  `#[allow(dead_code)]` ("retained for future per-component usage tracking")
  — this increment surfaces that link with a span.
- Follow the existing per-site record precedent: `UsageResidueRecord` in
  `usage_facts.rs` (`{binding, prop_name, file, span, kind}`, camelCase
  serialization, additive manifest field). Manifest assembly is in
  `engine.rs` (`AnalyzeResult`) — locate via `rg -n "usageResidue" …/src/`.
- New manifest fields: `staticCallsites: Vec<CallsiteRecord>` with
  `{binding, prop, file, span: {start, end}}` and `spreadMarkers:
  Vec<SpreadMarker>` with `{binding, file, span}`. Use
  `#[serde(skip_serializing_if = "Vec::is_empty")]` so corpora without
  matches serialize byte-identically to today.
- Verification chain for this footprint (root `AGENTS.md` Change-Type Map):
  `vp run verify:clippy && vp run verify:hygiene:rust && vp run
  verify:unit:rust && vp run verify:canary && vp run verify:parity && vp run
  verify:integration`.

## Plan

- [ ] 1. Write failing Rust unit test in `jsx_scan.rs` tests: scanning a source containing `<Box p={8} />` (Box a tracked binding) yields one callsite record `{binding: "Box", prop: "p"}` with a span covering the attribute.
- [ ] 2. `cargo test -p animus-extract-v2 callsite` (from `packages/extract`); expected: FAIL (type/collection missing).
- [ ] 3. Implement `CallsiteRecord` collection at the static-classification site of the attr walk; minimal code to pass; rerun — expected: PASS.
- [ ] 4. Write failing test: `<Box {...rest} />` yields one spread marker for `Box` with the spread's span; `<div {...rest} />` (untracked) yields none.
- [ ] 5. Implement `SpreadMarker` collection in the spread arm; rerun — expected: PASS.
- [ ] 6. Thread both through `FileFacts` aggregation into `AnalyzeResult` with `skip_serializing_if`; add a serialization unit test asserting field names `staticCallsites` / `spreadMarkers` and their absence when empty.
- [ ] 7. Checkpoint (G3 + full chain): run the six-command verification chain from the capsule; expected: every tier PASS, `verify:parity` prints `PARITY GATE: PASS`.

## Guardrail gate

G3 (additive-only extraction) is **active** for this footprint:

```
vp run verify:parity
```

Expected: `PARITY GATE: PASS` (calibrated PASS on 2026-07-19). Any
divergence is a STOP.

## Spec authorship checklist

- [x] — (envelope)

## Output contract (delegate)

Return: (a) the Rust type definitions added (paste), (b) the manifest field
names and a sample serialized fragment from a fixture run, (c) the names of
the unit tests added, (d) the tail of each verification-chain command proving
PASS, (e) any surprise (span semantics, fixture gaps) as journal-entry
candidates. Do not edit spec files (single-writer rule — orchestrator owns
specs/).
