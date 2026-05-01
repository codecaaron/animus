## ADDED Requirements

### Requirement: Eliminate unused variant option CSS

The reconciler SHALL remove CSS rules for variant options that are not in the usage ledger's used set for that component and variant prop. The remaining CSS SHALL contain only rules for variant options that are actually used at callsites.

#### Scenario: One of three options unused

- **WHEN** component `Button` has variant options `fill`, `stroke`, `outline` and the ledger shows only `stroke` and `outline` used
- **THEN** the reconciled CSS SHALL NOT contain the `.animus-Button-xxx--variant-fill` rule but SHALL contain rules for `stroke` and `outline`

#### Scenario: All options used

- **WHEN** all variant options for a component appear in the usage ledger
- **THEN** the reconciled CSS SHALL contain all variant option rules (no elimination)

#### Scenario: Default variant kept when implicit

- **WHEN** `Button` has `defaultVariant: "fill"` and the ledger records `"fill"` as used (via implicit default activation)
- **THEN** the reconciled CSS SHALL keep the `.animus-Button-xxx--variant-fill` rule

### Requirement: Eliminate unused state CSS

The reconciler SHALL remove CSS rules for state names that are not in the usage ledger's used set for that component.

#### Scenario: State never activated

- **WHEN** component `FlexBox` has states `fit`, `center`, `wrap` and the ledger shows only `center` used
- **THEN** the reconciled CSS SHALL NOT contain rules for `--fit` or `--wrap` but SHALL contain the `--center` rule

#### Scenario: All states used

- **WHEN** all state names for a component appear in the usage ledger
- **THEN** the reconciled CSS SHALL contain all state rules

### Requirement: Eliminate entire unused component CSS

The reconciler SHALL remove ALL CSS rules (base, variants, states) for components that are neither rendered at any callsite NOR referenced as a parent in the provenance graph.

#### Scenario: Component never rendered and not a parent

- **WHEN** `GridBox` is defined but never rendered (`<GridBox>` never appears) and no other component extends from it
- **THEN** the reconciled CSS SHALL contain NO rules for GridBox (no base, no variants, no states)

#### Scenario: Component not rendered but is a parent

- **WHEN** `Anchor` is never rendered as `<Anchor>` but `NavLink` extends from it
- **THEN** the reconciled CSS SHALL KEEP Anchor's rules — NavLink's merged CSS depends on them for cascade correctness

#### Scenario: Component rendered

- **WHEN** `Button` is rendered at least once via `<Button />`
- **THEN** the reconciled CSS SHALL keep Button's base styles (and used variants/states)

### Requirement: Reconciliation preserves CSS structure

The reconciled CSS SHALL maintain the same @layer structure, topological ordering, and formatting as the pre-reconciliation CSS. Only individual rules within layers are removed — the layer structure itself is unchanged.

#### Scenario: Layer still emitted with remaining rules

- **WHEN** `@layer variants` had 10 rules and reconciliation removes 6
- **THEN** `@layer variants` SHALL still be emitted with the remaining 4 rules

#### Scenario: Empty layer omitted

- **WHEN** reconciliation removes ALL rules from `@layer states` for all components
- **THEN** the `@layer states { }` block SHALL be omitted from the CSS output (no empty layer blocks)

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
