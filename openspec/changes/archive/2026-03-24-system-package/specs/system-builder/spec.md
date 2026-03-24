## ADDED Requirements

### Requirement: Concentric builder with sequential generic inference
The system builder SHALL provide a fluent API with callback-isolated phases: `.withTokens()` and `.withProperties()`. Each phase SHALL capture its generics independently via TypeScript's sequential method-chain inference. The terminal `.build()` SHALL return a `SystemInstance<T, PropRegistry, GroupRegistry>`.

#### Scenario: Full system definition
- **WHEN** consumer calls `createSystem().withTokens(t => t.breakpoints({...}).colors({...}).build()).withProperties(p => p.addGroup('surface', { color, border }).build()).build()`
- **THEN** the return type SHALL be `SystemInstance<T, PropReg, GroupReg>` where T is inferred from the token builder callback return and PropReg/GroupReg from the property builder callback return

#### Scenario: Token phase captures T
- **WHEN** consumer calls `.withTokens(t => t.colors({ primary: '#4f46e5', secondary: '#7c3aed' }).build())`
- **THEN** T SHALL include `{ colors: { primary: string; secondary: string } }` and subsequent phases SHALL have access to `T`

#### Scenario: Property phase captures PropRegistry and GroupRegistry
- **WHEN** consumer calls `.withProperties(p => p.addGroup('surface', { color, border }).addGroup('text', { typography }).build())`
- **THEN** PropRegistry SHALL be the union of all prop definitions across groups, and GroupRegistry SHALL map group names to their prop keys

#### Scenario: Phases are lexically isolated
- **WHEN** inside the `.withTokens()` callback
- **THEN** only ThemeBuilder methods SHALL be available (not `.addGroup()` or `.build()` from the system level)

### Requirement: Token phase reuses ThemeBuilder
The `.withTokens()` callback SHALL receive a fresh ThemeBuilder instance from `@animus-ui/theming`. The callback chains ThemeBuilder methods and returns the `.build()` result.

#### Scenario: ThemeBuilder methods available in callback
- **WHEN** consumer writes `.withTokens(t => t.breakpoints({...}).colors({...}).space([...]).colorModes('light', {...}).build())`
- **THEN** all existing ThemeBuilder methods SHALL work unchanged

#### Scenario: Pre-built theme accepted
- **WHEN** consumer has an existing theme object and writes `.withTokens(() => existingTheme)`
- **THEN** the system SHALL accept the pre-built theme and infer T from its type

### Requirement: Property builder accumulates groups
The `.withProperties()` callback SHALL receive a PropertyBuilder instance with `.addGroup(name, props)` method. Each `.addGroup()` call SHALL accumulate into PropRegistry and GroupRegistry generics.

#### Scenario: Multiple groups registered
- **WHEN** consumer calls `p.addGroup('surface', { color, border }).addGroup('text', { typography })`
- **THEN** PropRegistry SHALL contain all props from color, border, and typography, and GroupRegistry SHALL map `surface → ['color', 'borderColor', ...]` and `text → ['fontFamily', 'fontSize', ...]`

#### Scenario: Property builder terminal
- **WHEN** consumer calls `.build()` on the PropertyBuilder
- **THEN** the accumulated PropRegistry and GroupRegistry SHALL be captured and returned to the SystemBuilder

### Requirement: SystemInstance provides builder chain entry
The `.build()` terminal on SystemBuilder SHALL return a SystemInstance that exposes the Animus builder chain methods directly (`.styles()`, `.variant()`, etc.) with all generics pre-filled from the system definition.

#### Scenario: Component creation from system instance
- **WHEN** consumer calls `ds.styles({ bg: 'primary' }).groups(['surface']).asElement('div')`
- **THEN** `bg` SHALL autocomplete with values from `T['colors']` and `groups` SHALL only accept keys from `GroupRegistry`

#### Scenario: System instance carries T for scale resolution
- **WHEN** a prop definition has `scale: 'colors'` and the token phase defined `colors: { primary, secondary }`
- **THEN** autocomplete for that prop SHALL show `'primary' | 'secondary'` plus raw CSS values
