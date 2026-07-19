## ADDED Requirements

### Requirement: Explicit V1 layer-content routing

The V1 CSS generator SHALL dispatch each layer kind through one explicit
engine-local path while preserving exact emitted content and source order.

#### Scenario: Layer-content matrix remains stable

- **WHEN** two components contain base content, ordered variant options,
  matching, absent, and unmatched defaults, indexed compounds, and ordered
  states
- **THEN** `layer_content_preserves_kind_routing_order_and_selectors` SHALL pass
- **AND** its exact outputs SHALL preserve inter-component source order and omit
  sidecars for absent and unmatched defaults
- **AND** the G1 public-boundary diff check from `design.md` SHALL return empty

#### Scenario: Routing remains explicit and engine-local

- **WHEN** V1 layer routing is separated into layer-specific emitters
- **THEN** G2 SHALL find four private emitters, four calls, one top-level kind
  match, and no component-loop dispatch
- **AND** the G4 V2 CSS hash SHALL remain exact
- **AND** mapped V1 Clippy, Rust-unit, NAPI-canary, and integration commands
  SHALL exit zero
