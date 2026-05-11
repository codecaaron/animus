## ADDED Requirements

### Requirement: Sidecar default class not subject to reconciliation
The reconciler SHALL NOT attempt to prune or track sidecar default classes (`--{prop}-default`). Sidecar rules are structural artifacts of `defaultVariant` — they are always needed when the variant has a default and are emitted unconditionally by the CSS generator.

#### Scenario: Sidecar survives reconciliation
- **WHEN** component `Card` has variant `density` with `defaultVariant: 'comfortable'` and the reconciler prunes unused variant options
- **THEN** the sidecar rule `.animus-Card-xxx--density-default` SHALL remain in the output CSS regardless of which density options appear in the usage ledger

#### Scenario: Reconciler still prunes unused option-specific rules
- **WHEN** component `Card` has variant `density` with options `compact`, `comfortable`, `roomy` and only `compact` and `comfortable` are used
- **THEN** the reconciler SHALL prune `--density-roomy` but SHALL preserve `--density-default` (the sidecar for whichever option is the default)
