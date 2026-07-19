## ADDED Requirements

### Requirement: Active TypeScript test discovery

The TypeScript unit tier SHALL execute every active unit test under its owned package roots, including colocated system runtime tests and non-canary extractor tests.

#### Scenario: Colocated system test fails

- **WHEN** a test under `packages/system/src/` fails
- **THEN** `verify:unit:ts` and every composite containing it exit non-zero

#### Scenario: Non-canary extractor test fails

- **WHEN** a test under `packages/extract/tests/` other than the native canary fails
- **THEN** `verify:unit:ts` and every composite containing it exit non-zero

### Requirement: Host-native NAPI freshness

The NAPI freshness precondition SHALL compare Rust inputs against the exact binary selected for the current platform, architecture, and Linux libc.

#### Scenario: Foreign binary is fresh and host binary is stale

- **WHEN** a foreign-target binary is newer than Rust inputs and the current host binary is older
- **THEN** the freshness precondition exits non-zero and identifies the stale host binary

#### Scenario: Host binary is fresh

- **WHEN** the current host binary exists and is newer than every owned Rust input
- **THEN** the freshness precondition succeeds regardless of foreign binary timestamps

### Requirement: Rust lint suppression policy

The strict Clippy tier SHALL reject authored active Rust source containing crate-wide or module-wide `allow(warnings)` or `allow(clippy::all)` suppression.

#### Scenario: Blanket suppression is introduced

- **WHEN** an active Rust source contains blanket warning or Clippy suppression
- **THEN** `verify:clippy` exits non-zero and reports the source location

#### Scenario: Narrow justified suppression remains

- **WHEN** an active Rust source contains an allow for a named lint other than the blanket groups
- **THEN** the suppression policy does not fail that source before Clippy evaluates it

### Requirement: Rust dependency ignore policy

The Rust dependency hygiene tier SHALL reject a non-empty cargo-machete ignore list before running the unused-dependency detector.

#### Scenario: Ignored dependency is added

- **WHEN** parsed Cargo metadata exposes one or more cargo-machete ignored dependencies
- **THEN** `verify:hygiene:rust` exits non-zero and lists the package and ignored dependency names

#### Scenario: Ignore lists are empty

- **WHEN** parsed Cargo metadata contains no ignored dependency
- **THEN** `verify:hygiene:rust` proceeds to cargo-machete detection

