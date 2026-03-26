## REMOVED Requirements

### Requirement: Token phase reuses ThemeBuilder
**Reason**: Module augmentation on the `Theme` interface handles type drilling. Theme construction is a consumer concern, not a SystemBuilder concern. `withTokens()` was unnecessary ceremony — consumers already build tokens separately and pass them through unchanged.
**Migration**: Remove `.withTokens(() => tokens)` from the chain. Build tokens separately via `createTheme()`, export as a named `tokens` export, augment `Theme` via module declaration. The plugin loads tokens directly from the module export.

## MODIFIED Requirements

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

### Requirement: SystemInstance provides builder chain entry
The `.build()` terminal on SystemBuilder SHALL return a SystemInstance that exposes the Animus builder chain methods directly (`.styles()`, `.variant()`, etc.) with PropRegistry and GroupRegistry pre-filled from the system definition. Scale resolution uses the augmented `Theme` interface.

#### Scenario: Component creation from system instance
- **WHEN** consumer calls `ds.styles({ bg: 'primary' }).groups(['surface']).asElement('div')`
- **THEN** `bg` SHALL autocomplete with values from the augmented `Theme['colors']` and `groups` SHALL only accept keys from `GroupRegistry`

#### Scenario: Scale resolution via module augmentation
- **WHEN** the consumer has augmented `Theme` with `{ colors: { primary: string; secondary: string } }` and a prop definition has `scale: 'colors'`
- **THEN** autocomplete for that prop SHALL show `'primary' | 'secondary'` plus raw CSS values

### Requirement: Serialization excludes tokens
The `serialize()` method on SystemInstance SHALL return `{ propConfig, groupRegistry, transforms, globalStyles }`. It SHALL NOT include a `tokens` field. The plugin loads tokens independently from the module's named exports.

#### Scenario: serialize() return shape
- **WHEN** `ds.serialize()` is called
- **THEN** the return SHALL contain `propConfig` (JSON string), `groupRegistry` (JSON string), `transforms` (record of named transforms), and optionally `globalStyles` — but NOT `tokens`
