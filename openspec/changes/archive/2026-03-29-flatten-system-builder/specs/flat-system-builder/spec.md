## ADDED Requirements

### Requirement: addGroup directly on SystemBuilder
`SystemBuilder` SHALL expose an `.addGroup(name, config)` method that registers props and assigns them to a named group in a single call. No callback wrapper or inner builder required.

#### Scenario: Single group registration
- **WHEN** a consumer calls `createSystem().addGroup('surface', { bg: { property: 'backgroundColor', scale: 'colors' } })`
- **THEN** `bg` SHALL be registered in the prop registry with the given definition
- **AND** `bg` SHALL be assigned to the group `'surface'` in the group registry

#### Scenario: Chained group registration
- **WHEN** a consumer chains `.addGroup('surface', {...}).addGroup('text', {...}).addGroup('space', space)`
- **THEN** all props from all groups SHALL be registered in a single flat prop registry
- **AND** each group SHALL map to its respective prop keys in the group registry
- **AND** the chain SHALL terminate with a single `.build()` call

#### Scenario: Single build terminal
- **WHEN** a consumer calls `createSystem().addGroup(...).addGroup(...).build()`
- **THEN** there SHALL be exactly one `.build()` call in the chain
- **AND** no inner `.build()` or callback SHALL be required

### Requirement: addProps for ungrouped registration
`SystemBuilder` SHALL expose an `.addProps(config)` method that registers props without assigning them to any group.

#### Scenario: Ungrouped prop registration
- **WHEN** a consumer calls `.addProps({ ratio: { property: 'aspectRatio', transform: ratio } })`
- **THEN** `ratio` SHALL be registered in the prop registry
- **AND** `ratio` SHALL NOT appear in any group in the group registry

#### Scenario: Ungrouped props participate in style resolution
- **WHEN** an ungrouped prop like `ratio` is registered
- **THEN** it SHALL be available in `.styles()`, `.variant()`, `.compound()`, and `.states()` for token resolution and transform application
- **AND** the extraction pipeline SHALL resolve its values using the prop config

### Requirement: Overlap-tolerant prop registration
When the same prop key appears in multiple `.addGroup()` calls with identical definitions, the prop SHALL be registered once and belong to all groups that include it.

#### Scenario: Identical prop in two groups
- **WHEN** `gap` appears in both `.addGroup('flex', { ...flex })` and `.addGroup('grid', { ...grid })` with identical definitions
- **THEN** `gap` SHALL be registered once in the prop registry
- **AND** `gap` SHALL appear in both `'flex'` and `'grid'` groups
- **AND** no error or warning SHALL be produced

#### Scenario: Conflicting prop definitions
- **WHEN** a prop key appears in two `.addGroup()` calls with different definitions (different property, scale, or transform)
- **THEN** a type error SHALL be produced at compile time
- **AND** a runtime error SHALL be thrown with a descriptive message naming the conflicting prop and groups

### Requirement: Group names must not collide with prop names
The builder SHALL enforce that group names and prop names are disjoint sets to prevent ambiguity in the activation namespace.

#### Scenario: Group name collides with existing prop
- **WHEN** a consumer calls `.addGroup('bg', { ... })` and `bg` is already registered as a prop name
- **THEN** a type error SHALL be produced at compile time

#### Scenario: Prop name collides with existing group
- **WHEN** a consumer calls `.addGroup('surface', { surface: { property: 'background' } })` where `surface` is already a group name
- **THEN** a type error SHALL be produced at compile time indicating the prop name `surface` conflicts with the group name

### Requirement: PropertyBuilder is removed
The `PropertyBuilder` class and `.withProperties()` method SHALL be removed from the public API.

#### Scenario: PropertyBuilder not exported
- **WHEN** a consumer imports from `@animus-ui/system`
- **THEN** `PropertyBuilder` SHALL NOT be available as an export

#### Scenario: withProperties not available
- **WHEN** a consumer accesses a `SystemBuilder` instance
- **THEN** `.withProperties()` SHALL NOT exist as a method

## REMOVED Requirements

### Requirement: PropertyBuilder class
**Reason**: Replaced by direct `.addGroup()` and `.addProps()` on SystemBuilder. The inner builder added ceremony without structural benefit.
**Migration**: Replace `.withProperties((p) => p.addGroup(...).build())` with direct `.addGroup(...)` on the SystemBuilder chain.

### Requirement: withProperties callback wrapper
**Reason**: The callback boundary served no purpose — PropertyBuilder was disposable, used once within the callback and discarded.
**Migration**: Remove the callback and inner `.build()`. Chain `.addGroup()` calls directly on SystemBuilder.
