## ADDED Requirements

### Requirement: Typed patch operations

The harness SHALL define a typed patch representation for style mutations — at minimum setting and unsetting a system or custom prop, selecting a variant value, and toggling a state — validated against per-project schemas derived from the universe manifest's enumerations.

#### Scenario: Invalid value rejected at validation

- **WHEN** a patch sets a variant prop to a value outside that component's declared options
- **THEN** validation rejects the patch before any file is modified, naming the legal options

#### Scenario: Schemas reflect the project

- **WHEN** the workspace's theme scales or variant declarations change and analysis re-runs
- **THEN** newly derived patch schemas reflect the updated enumerations

### Requirement: Deterministic application

Applying a validated patch SHALL be deterministic and span-addressed: the same patch against the same workspace state produces byte-identical file output.

#### Scenario: Repeatable application

- **WHEN** the same validated patch is applied twice to two identical copies of a workspace
- **THEN** the resulting files are byte-identical

### Requirement: Verification follows application

Every applied patch SHALL be followed by re-analysis and a verdict-bearing answer against the originating StyleGoal; schema validity SHALL NOT be treated as verification.

#### Scenario: Schema-valid but wrong value

- **WHEN** a patch is schema-valid but produces declarations that do not satisfy the goal
- **THEN** the post-application answer's verdict is `divergent`, not `exact`
