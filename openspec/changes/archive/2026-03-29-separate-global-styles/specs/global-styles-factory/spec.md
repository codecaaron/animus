## ADDED Requirements

### Requirement: Build returns system and globalStyles factory
`createSystem().build()` SHALL return an object with two properties: `system` (the Animus component authoring instance) and `createGlobalStyles` (a factory function for producing global style blocks).

#### Scenario: Destructured build result
- **WHEN** a consumer calls `createSystem().addGroup(...).build()`
- **THEN** the return value SHALL be `{ system: SystemInstance, createGlobalStyles: GlobalStylesFactory }`
- **AND** `system` SHALL be an Animus instance with `.styles()`, `.variant()`, and all component chain methods
- **AND** `createGlobalStyles` SHALL be a function that accepts a selector-to-styles map

#### Scenario: System instance has no global style methods
- **WHEN** a consumer accesses the `system` property from the build result
- **THEN** the instance SHALL NOT have a `withGlobalStyles` method
- **AND** the instance SHALL NOT carry any global style configuration

### Requirement: createGlobalStyles produces composable blocks
The `createGlobalStyles` factory SHALL accept a flat `Record<string, Record<string, any>>` mapping CSS selectors to style objects. Each call produces an independent global style block.

#### Scenario: Single global style block
- **WHEN** a consumer calls `createGlobalStyles({ 'html, body': { bg: 'bg', color: 'text' } })`
- **THEN** it SHALL produce a global style block with resolved prop shorthand and token values

#### Scenario: Multiple independent blocks
- **WHEN** a consumer calls `createGlobalStyles` multiple times with different selector maps
- **THEN** each call SHALL produce an independent block
- **AND** blocks SHALL NOT share state or interfere with each other

#### Scenario: Keyframes in global styles
- **WHEN** a consumer includes `@keyframes` selectors in a global style block
- **THEN** the factory SHALL support nested keyframe structures (selector → percentages → props)
- **AND** keyframe values SHALL resolve prop shorthand and token aliases

### Requirement: Global styles factory shares token vocabulary
The `createGlobalStyles` factory SHALL resolve prop shorthand, scale lookups, transforms, and token aliases using the prop registry and transform map from the system build that produced it.

#### Scenario: Prop shorthand resolution
- **WHEN** a global style block contains `{ bg: 'surface', p: 24 }`
- **THEN** `bg` SHALL resolve to `background-color` via the prop config
- **AND** `p` SHALL resolve to `padding` with scale lookup via the prop config

#### Scenario: Token alias resolution
- **WHEN** a global style block contains `{ boxShadow: '0 0 8px {colors.primary/40}' }`
- **THEN** the token alias SHALL resolve to `color-mix(in srgb, var(--color-primary) 40%, transparent)`

#### Scenario: Transform application
- **WHEN** a global style block uses a prop that has a named transform (e.g., `fluidSize`)
- **THEN** the transform SHALL be applied during resolution

### Requirement: Plugin discovers global styles from module exports
The Vite plugin SHALL discover global style blocks from named exports in the system module file, not from `serialize().globalStyles`.

#### Scenario: Default export discovery
- **WHEN** the system module exports named variables created by `createGlobalStyles`
- **THEN** the plugin SHALL import these exports and resolve them via the existing subprocess pipeline

#### Scenario: No global styles exported
- **WHEN** the system module does not export any global style blocks
- **THEN** the plugin SHALL emit no `@layer global` content
- **AND** no error or warning SHALL be produced

## REMOVED Requirements

### Requirement: withGlobalStyles on SystemBuilder
**Reason**: Global styles are a document-level emission concern, not a component API vocabulary concern. Mixing them on the same builder chain conflated two distinct responsibilities.
**Migration**: Replace `.withGlobalStyles({ reset: {...}, global: {...} })` with separate `createGlobalStyles({...})` calls using the factory from `.build()`.

### Requirement: GlobalStylesConfig type with reset/global split
**Reason**: The `{ reset?: GlobalStyleMap, global?: GlobalStyleMap }` structure prescribed an arbitrary organizational split. Consumers should organize global styles however they want.
**Migration**: Merge reset and global into flat selector maps passed to `createGlobalStyles()`.
