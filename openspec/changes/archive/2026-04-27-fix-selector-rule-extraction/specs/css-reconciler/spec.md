## ADDED Requirements

### Requirement: Dev/build reconciler parity for component elimination
Component-elimination decisions SHALL be consistent between `dev_mode=true` and `dev_mode=false` invocations of `analyzeProject` — OR any intentional divergence SHALL surface in dev mode as an authoring-time diagnostic matching what build mode would eliminate. The reconciler SHALL NOT silently keep components in dev that it eliminates in build. Silent divergence hides JSX-scanner gaps from authoring feedback, causing scanner-related regressions to surface only at deploy time instead of at authoring time.

Acceptable implementation strategies (captured in design.md; the spec constrains the observable contract, not the strategy):
1. Eliminate in both modes (strictest; may break dev HMR flows where a component is added but not yet rendered).
2. Retain in both modes (weakest dead-code elimination; simplest to implement).
3. Retain in dev + emit dev-mode diagnostic for anything that would be eliminated in build (compromise; preserves HMR while closing the authoring-feedback gap). RECOMMENDED in design.md.

#### Scenario: Dev and build agree when component is rendered
- **WHEN** a component is rendered via any recognized pattern (JSX element, JSX member expression, `createElement(...)` bare ident or member expr) AND appears in the usage ledger
- **THEN** both `dev_mode=true` and `dev_mode=false` SHALL keep the component's CSS — parity holds, no divergence

#### Scenario: Dev surfaces prospective build-mode elimination
- **WHEN** `dev_mode=true`, a ds-built component is defined in the project but not recognized as rendered by the JSX scanner, such that `dev_mode=false` would eliminate it
- **THEN** the manifest's `report.eliminated_details` SHALL include an entry for the component with `kind: "prospective_component"` and a reason explaining it would be eliminated in production, enabling `extraction-diagnostics` to surface a warning at authoring time
- **AND** `report.components_eliminated` SHALL remain `0` in dev mode — prospective entries SHALL NOT inflate actual-elimination counters, preserving the invariant that actual-elimination counts match the number of `kind: "component"` entries only

#### Scenario: Dev does not silently keep a component that build eliminates
- **WHEN** a component is kept in `dev_mode=true` output that would be absent from `dev_mode=false` output
- **THEN** the manifest SHALL carry a dev-mode diagnostic record making the divergence observable — authoring feedback SHALL NOT depend on running a production build to reveal scanner blind spots
