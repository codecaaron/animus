## ADDED Requirements

### Requirement: Concentric builder with sequential generic inference
The system builder SHALL provide a fluent API with callback-isolated phases: `.withProperties()` and `.withGlobalStyles()`. The `.withProperties()` phase SHALL capture its generics via TypeScript's sequential method-chain inference. The terminal `.build()` SHALL return a `SystemInstance<PropRegistry, GroupRegistry>`.

#### Scenario: Full system definition
- **WHEN** consumer calls `createSystem().withProperties(p => p.addGroup('surface', { color, border }).build()).withGlobalStyles({...}).build()`
- **THEN** the return type SHALL be `SystemInstance<PropReg, GroupReg>` where PropReg/GroupReg are inferred from the property builder callback return

#### Scenario: Property phase captures PropRegistry and GroupRegistry
- **WHEN** consumer calls `.withProperties(p => p.addGroup('surface', { color, border }).addGroup('text', { typography }).build())`
- **THEN** PropRegistry SHALL be the union of all prop definitions across groups, and GroupRegistry SHALL map group names to their prop keys

#### Scenario: No token phase
- **WHEN** consumer calls `createSystem()`
- **THEN** the returned builder SHALL NOT have a `.withTokens()` method. Theme construction is handled separately by the consumer.

### Requirement: Property builder accumulates groups
The `.withProperties()` callback SHALL receive a PropertyBuilder instance with `.addGroup(name, props)` method. Each `.addGroup()` call SHALL accumulate into PropRegistry and GroupRegistry generics.

#### Scenario: Multiple groups registered
- **WHEN** consumer calls `p.addGroup('surface', { color, border }).addGroup('text', { typography })`
- **THEN** PropRegistry SHALL contain all props from color, border, and typography, and GroupRegistry SHALL map `surface → ['color', 'borderColor', ...]` and `text → ['fontFamily', 'fontSize', ...]`

#### Scenario: Property builder terminal
- **WHEN** consumer calls `.build()` on the PropertyBuilder
- **THEN** the accumulated PropRegistry and GroupRegistry SHALL be captured and returned to the SystemBuilder

### Requirement: SystemInstance provides builder chain entry
The `.build()` terminal on SystemBuilder SHALL return a SystemInstance that exposes the Animus builder chain methods directly (`.styles()`, `.variant()`, etc.) with PropRegistry and GroupRegistry pre-filled from the system definition. Scale resolution uses the augmented `Theme` interface.

#### Scenario: Component creation from system instance
- **WHEN** consumer calls `ds.styles({ bg: 'primary' }).groups(['surface']).asElement('div')`
- **THEN** `bg` SHALL autocomplete with values from the augmented `Theme['colors']` and `groups` SHALL only accept keys from `GroupRegistry`

#### Scenario: Scale resolution via module augmentation
- **WHEN** the consumer has augmented `Theme` with `{ colors: { primary: string; secondary: string } }` and a prop definition has `scale: 'colors'`
- **THEN** autocomplete for that prop SHALL show `'primary' | 'secondary'` plus raw CSS values

### Requirement: Augmentable Theme interface
The system package SHALL export an augmentable `Theme` interface from `@animus-ui/system`. Consumers extend this via module augmentation to enable compile-time scale constraints in `.styles()`, `.variant()`, and `.states()` CSS objects.

#### Scenario: Module augmentation
- **WHEN** consumer writes `declare module '@animus-ui/system' { interface Theme extends ShowcaseTheme {} }` in their system definition file
- **THEN** all CSS object types in the builder chain SHALL constrain property values to the theme's scale keys

#### Scenario: Theme interface is empty by default
- **WHEN** `Theme` is NOT augmented
- **THEN** it SHALL extend `BaseTheme` with no additional properties, and CSS object values SHALL fall back to standard CSS property types

#### Scenario: Theme exported from package index
- **WHEN** consumer imports from `@animus-ui/system`
- **THEN** `Theme` SHALL be available as a named type export alongside `BaseTheme`, `Breakpoints`, and `TokenScales`

#### Scenario: ThemedCSSProps and ThemedScale exported
- **WHEN** the system package is consumed as a library
- **THEN** `ThemedCSSProps`, `ThemedCSSPropMap`, `ThemedScale`, and `ThemedScaleValue` SHALL be exported from the package index to satisfy TS2742 declaration portability requirements

### Requirement: Serialization excludes tokens
The `serialize()` method on SystemInstance SHALL return `{ propConfig, groupRegistry, transforms, globalStyles }`. It SHALL NOT include a `tokens` field. The plugin loads tokens independently from the module's named exports.

#### Scenario: serialize() return shape
- **WHEN** `ds.serialize()` is called
- **THEN** the return SHALL contain `propConfig` (JSON string), `groupRegistry` (JSON string), `transforms` (record of named transforms), and optionally `globalStyles` — but NOT `tokens`
