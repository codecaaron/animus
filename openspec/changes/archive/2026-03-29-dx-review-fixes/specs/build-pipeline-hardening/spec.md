## ADDED Requirements

### Requirement: Strict mode throws on subprocess failure
When the vite plugin is configured with `strict: true`, subprocess failures during `buildStart` SHALL throw an error instead of logging a warning.

#### Scenario: System module subprocess fails in strict mode
- **WHEN** `loadSystem()` subprocess fails
- **AND** `options.strict` is `true`
- **THEN** the plugin SHALL throw an error with the subprocess error message

#### Scenario: System module subprocess fails in non-strict mode
- **WHEN** `loadSystem()` subprocess fails
- **AND** `options.strict` is `false` or unset
- **THEN** the plugin SHALL log a warning (existing behavior, no change)

### Requirement: globalThis keys are scoped to plugin instance
The vite plugin SHALL NOT use bare `globalThis` keys for internal state. Build-time state SHALL use closure-scoped variables. HMR state SHALL use namespaced keys derived from the system module path.

#### Scenario: Two Animus plugins in same process
- **WHEN** two `animusExtract()` plugins are instantiated with different system modules in the same Node process
- **THEN** each plugin instance SHALL maintain independent state
- **AND** neither SHALL overwrite the other's resolve script or stylesheet references

### Requirement: Vestigial .build() method removed
The `.build()` method on the component builder chain SHALL be removed. The terminal methods are `.asElement()`, `.asComponent()`, and `.asClass()`.

#### Scenario: Calling .build() produces a type error
- **WHEN** a developer writes `ds.styles({}).build()`
- **THEN** TypeScript SHALL report a type error (method does not exist)

#### Scenario: .extend() remains available on terminal methods
- **WHEN** a developer calls `.asElement('div')`
- **THEN** the returned component SHALL have an `.extend()` method

### Requirement: Stale compose export comment removed
The comment in Card.tsx lines 12-14 claiming slots need export for extraction SHALL be removed. The exports themselves SHALL remain for module organization.

#### Scenario: Card.tsx has no extraction-necessity comment
- **WHEN** reading Card.tsx
- **THEN** there SHALL be no comment about exporting for the extraction pipeline
- **AND** `CardRoot`, `CardHeader`, `CardBody`, `CardFooter` SHALL remain exported
