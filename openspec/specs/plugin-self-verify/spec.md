## Purpose

The `animusExtract()` plugin SHALL expose a `verify` option that runs structural self-checks in `buildStart` after analysis completes. Self-verification provides a fast, in-plugin check that extraction succeeded (non-empty component CSS, correct layer ordering, present `:root` block, no `__TRANSFORM__` placeholders) so that misconfigured consumers surface problems immediately rather than at post-build assertion time.

## Requirements

### Requirement: Dev server self-verification flag
The `animusExtract()` plugin SHALL accept a `verify` option (default: `false`) that runs structural self-checks during `buildStart` after analysis completes.

#### Scenario: Verify option accepted
- **WHEN** `animusExtract({ system: './src/ds.ts', verify: true })` is configured
- **THEN** the plugin SHALL run self-verification checks after `buildStart` analysis

#### Scenario: Verify disabled by default
- **WHEN** `animusExtract({ system: './src/ds.ts' })` is configured without `verify`
- **THEN** the plugin SHALL NOT run self-verification checks

### Requirement: Verification checks
When `verify: true`, the plugin SHALL validate the following after `buildStart` completes:

#### Scenario: Component CSS is non-empty
- **WHEN** verification runs
- **THEN** the resolved component CSS SHALL be non-empty (at least one component extracted)
- **AND** failure SHALL log `[animus:verify] No component CSS produced — check system file and include patterns`

#### Scenario: Layer ordering is correct
- **WHEN** verification runs
- **THEN** the assembled CSS SHALL have layers in correct positional order: declaration before variables, variables before globals, globals before component CSS
- **AND** failure SHALL log `[animus:verify] CSS layer ordering violated — {details}`

#### Scenario: Variable CSS contains root block
- **WHEN** verification runs
- **THEN** the variable CSS SHALL contain a `:root` block
- **AND** failure SHALL log `[animus:verify] No :root variable block found in variable CSS`

#### Scenario: No transform placeholders
- **WHEN** verification runs
- **THEN** no CSS output SHALL contain `__TRANSFORM__` strings
- **AND** failure SHALL log `[animus:verify] Unresolved __TRANSFORM__ placeholders found in CSS`

### Requirement: Verification failure behavior
Verification failures SHALL respect the existing `strict` option.

#### Scenario: Strict mode throws
- **WHEN** `verify: true` and `strict: true` and a verification check fails
- **THEN** the plugin SHALL throw an error (halting the build)

#### Scenario: Non-strict mode warns
- **WHEN** `verify: true` and `strict` is false or unset and a verification check fails
- **THEN** the plugin SHALL log warnings but continue the build
