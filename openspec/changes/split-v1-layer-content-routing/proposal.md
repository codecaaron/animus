# Proposal: split V1 layer-content routing

## Why

The V1 layer-content generator nests generic layer selection around four
different component traversal policies. That obscures selector and ordering
contracts in a high-risk, single-owner file.

## What changes

- Characterize exact per-layer CSS and inter-component order for base, ordered
  variant options, matching default sidecars, absent/unmatched-default
  omission, indexed compounds, and ordered states directly against
  `generate_layer_content()`.
- Add four private, layer-specific emitters.
- Dispatch once on `LayerKind` before component traversal.
- Capture the V1-local CSS routing boundary in OODA artifacts.

## What does not change

- No public type/signature, caller, layer name/declaration, selector, ordering,
  formatting, pseudo/responsive behavior, manifest, runtime output, or V2
  source.
- No refactor of `generate_css_sheets_ordered()` and no cross-engine sharing.
- No repair of broader canonical layer-contract wording.

## Capability

- ADDED: `arch-extract-v1-layer-content-routing` — explicit, engine-local V1
  routing for the four legacy layer-content emitters.

## Impact

- Source: `packages/extract/src/css_generator.rs` only.
- Verification: strict OODA validation and mapped V1 Clippy, Rust units, NAPI
  canary, and integration.
- Risk: near-99th-percentile hotspot file, mitigated by exact output
  characterization, V2/dirty hashes, structural RED, and independent two-phase
  review.
