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
