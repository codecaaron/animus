## ADDED Requirements

### Requirement: No cross-package test imports

No test file in `packages/system/`, `packages/extract/`, or `packages/vite-plugin/` SHALL import from `@animus-ui/core` or `@animus-ui/theming`. All test dependencies SHALL be satisfied by the consumer surface packages (`@animus-ui/system`, `@animus-ui/vite-plugin`) or package-internal code.

#### Scenario: Extract fixture files use consumer API

- **WHEN** searching all `.tsx` and `.ts` files in `packages/extract/tests/fixtures/`
- **THEN** no file SHALL contain `import` from `@animus-ui/core`
- **AND** no file SHALL contain `import` from `@animus-ui/theming`

#### Scenario: Config serialization uses system exports

- **WHEN** searching the config serialization file in extract tests
- **THEN** prop group imports SHALL come from `@animus-ui/system/groups` (or equivalent monorepo path)
- **AND** transform imports SHALL come from `@animus-ui/system` (or equivalent monorepo path)
- **AND** no relative path SHALL reach into `packages/core/`

#### Scenario: System tests remain self-contained

- **WHEN** searching all test files in `packages/system/__tests__/`
- **THEN** no file SHALL contain imports from `@animus-ui/core` or `@animus-ui/theming`

### Requirement: Shared extract test system

The extract package tests SHALL have a shared test-system file that builds a real system via `createSystem()` from `@animus-ui/system`, providing a `ds` builder instance to all fixture files.

#### Scenario: Test system builds via consumer API

- **WHEN** the shared test-system file is evaluated
- **THEN** it SHALL call `createSystem()` from `@animus-ui/system`
- **AND** it SHALL add prop groups using `.addGroup()` with groups imported from `@animus-ui/system/groups`
- **AND** it SHALL export a `ds` system instance for use by fixture files

#### Scenario: Test system covers all fixture-needed prop groups

- **WHEN** fixture files reference system props (space, color, layout, typography, etc.)
- **THEN** the shared test-system SHALL include all prop groups required by the fixture set
- **AND** the test theme SHALL include all scale entries referenced in fixture style values

#### Scenario: Fixture files import from shared test system

- **WHEN** a fixture file needs a builder chain root
- **THEN** it SHALL import `ds` from the shared test-system file
- **AND** it SHALL use `ds.styles({...}).variant({...}).asElement('div')` pattern (not `animus.styles()`)

### Requirement: Config serialization from system source of truth

The extract test config serialization SHALL derive its prop registry and group registry from `@animus-ui/system`'s exported groups, maintaining the programmatic-from-source-of-truth principle.

#### Scenario: Serialized config matches system's groups

- **WHEN** the config serialization runs
- **THEN** the output SHALL contain all props defined in system's groups (space, color, typography, flex, grid, layout, border, shadows, background, positioning, transitions)
- **AND** transform mappings SHALL reference the same transforms exported by system (size, borderShorthand, gridItem, gridItemRatio)

#### Scenario: Config updates automatically with system changes

- **WHEN** a prop is added to or removed from a group in `packages/system/src/groups/index.ts`
- **THEN** the serialized config SHALL reflect the change without manual intervention
