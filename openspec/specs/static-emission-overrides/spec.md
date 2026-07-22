# static-emission-overrides Specification

## Purpose
TBD - created by archiving change static-emission-overrides. Update Purpose after archive.
## Requirements
### Requirement: Declarative forced-emission configuration

Both extraction plugins SHALL accept a `staticCss` option declaring emission the scanner may never observe: per-component variant options (a listed subset or `'*'` for all declared options), per-component states (listed or `'*'`), per-component custom dynamic prop slots, and system-prop value lists (each value a string, number, or responsive object form). The declaration SHALL reach the analysis engine with the other analysis inputs; identical declarations SHALL produce identical output across repeated analyses.

#### Scenario: Forced variant survives with zero observed usage

- **WHEN** no analyzed file renders `<Button variant="ghost" />` and `staticCss` declares `components: { Button: { variants: { variant: ['ghost'] } } }`
- **THEN** the emitted CSS SHALL contain Button's `ghost` variant styles

#### Scenario: Wildcard bounded by declared options

- **WHEN** `staticCss` declares `components: { Button: { variants: '*' } }`
- **THEN** every declared variant option of Button SHALL be emitted, and nothing beyond the declared options

#### Scenario: Never-rendered component is kept

- **WHEN** a component appears in `staticCss.components` and no JSX callsite renders it
- **THEN** the component SHALL NOT be eliminated by reconciliation

#### Scenario: Forced system-prop utilities

- **WHEN** `staticCss` declares `systemProps: { p: [4, { _: 8, sm: 16 }] }`
- **THEN** the emitted utilities SHALL include the `p` classes for value `4` and for the responsive form `{ _: 8, sm: 16 }`

#### Scenario: Forced custom dynamic slot

- **WHEN** a component's custom prop has no statically detected dynamic usage and `staticCss` declares it under that component's `dynamicProps`
- **THEN** the component's dynamic slot metadata and slot class for that prop SHALL be emitted

### Requirement: Forced emission flows through the usage accounting

Forced declarations SHALL be applied as synthetic usage entering the same ledger and emission machinery as observed usage — there SHALL be no separate forced-CSS generation path. With an empty or absent `staticCss`, output SHALL be byte-identical to a build without the feature.

#### Scenario: Empty configuration is a no-op

- **WHEN** `staticCss` is absent or `{}`
- **THEN** every emitted artifact SHALL be byte-identical to a build without the option

#### Scenario: Forced and observed usage compose

- **WHEN** `variant="fill"` is observed at a callsite and `staticCss` forces `['ghost']` on the same prop
- **THEN** both `fill` and `ghost` SHALL be emitted

### Requirement: Unmatched declarations are diagnosed, not fatal

A forced declaration naming a component, variant prop, variant option, state, or system prop that does not exist in the analyzed universe SHALL produce a warning diagnostic identifying the unmatched name, and SHALL NOT fail the build or affect other declarations.

#### Scenario: Typo in a component name warns

- **WHEN** `staticCss` names component `Buton` and no such binding exists
- **THEN** a warning diagnostic SHALL identify `Buton` as unmatched
- **AND** the build SHALL succeed with all other declarations applied

