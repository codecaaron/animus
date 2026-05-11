### Requirement: ThemeBuilder addContextualVars method

The ThemeBuilder SHALL provide an `addContextualVars` method that declares phantom scale members resolving to CSS custom properties. The method SHALL accept a config object with `scale` (an existing scale name in `keyof T`) and `vars` (an object mapping contextual var names to CSS custom property names). Object keys SHALL narrow to literal types without requiring `as const` at the callsite.

#### Scenario: Basic contextual var declaration

- **WHEN** the theme chain calls `.addContextualVars({ scale: 'colors', vars: { 'current-bg': '--current-bg' } })`
- **THEN** `keyof TokenScales<Theme>['colors']` SHALL include `'current-bg'`
- **AND** existing color keys SHALL remain unchanged

#### Scenario: Multiple contextual vars on one scale

- **WHEN** the theme chain calls `.addContextualVars({ scale: 'colors', vars: { 'current-bg': '--current-bg', 'current-border-color': '--current-border-color' } })`
- **THEN** `keyof TokenScales<Theme>['colors']` SHALL include both `'current-bg'` and `'current-border-color'`

#### Scenario: Type narrowing without as const

- **WHEN** a user writes `.addContextualVars({ scale: 'colors', vars: { 'current-bg': '--current-bg' } })` without `as const`
- **THEN** the var names SHALL be inferred as literal string types, not widened to `string`

#### Scenario: Scale must exist

- **WHEN** `.addContextualVars({ scale: 'bogus', vars: { ... } })` is called with a scale not in `keyof T`
- **THEN** TypeScript SHALL produce a type error on `scale`

#### Scenario: Chainable with checkpoint

- **WHEN** `.addContextualVars()` is called in the builder chain
- **THEN** it SHALL return a new `ThemeBuilder` instance via `#checkpoint` with the widened type
- **AND** subsequent chain methods SHALL see the updated type

### Requirement: Phantom type merging

Contextual var names SHALL exist as keys in the scale's type but SHALL NOT exist as values in the runtime theme object. They are type-only (phantom) members.

#### Scenario: Type includes phantom keys

- **WHEN** `addContextualVars` adds `'current-bg'` to the colors scale
- **THEN** `'current-bg'` SHALL be a valid value for any prop with `scale: 'colors'` (e.g., `bg`, `color`, `borderColor`, `fill`)

#### Scenario: Runtime theme unchanged

- **WHEN** `addContextualVars` is called
- **THEN** the runtime theme object passed to `#checkpoint` SHALL be identical to the theme before the call — no new keys added to the runtime object

#### Scenario: Phantom keys do not appear in manifest

- **WHEN** the theme is serialized via `.build()` and the manifest is generated
- **THEN** contextual var names SHALL NOT appear in the `_variables` or token manifest as emitted tokens

### Requirement: Contextual var serialization

The theme serialization SHALL include a `contextualVars` registry mapping scale names to their contextual var entries (name → CSS custom property).

#### Scenario: Serialized output includes registry

- **WHEN** the theme has `.addContextualVars({ scale: 'colors', vars: { 'current-bg': '--current-bg' } })`
- **THEN** `theme._contextualVars` SHALL contain `{ colors: { 'current-bg': '--current-bg' } }`

#### Scenario: Registry available to Rust extractor

- **WHEN** the vite plugin evaluates the theme and passes data to the Rust extractor
- **THEN** the contextual var registry SHALL be included in the serialized theme data alongside `scalesJson` and `variableMapJson`

### Requirement: Rust contextual var resolution

The Rust extractor SHALL resolve contextual var names to their CSS custom property values when encountered as style values.

#### Scenario: Contextual var as direct value

- **WHEN** a component has `borderColor: 'current-bg'` and `current-bg` is in the contextual vars registry for `colors`
- **THEN** the extracted CSS SHALL contain `border-color: var(--current-bg)`

#### Scenario: Contextual var in token ref syntax

- **WHEN** a component has `boxShadow: '0 0 8px {colors.current-bg}'`
- **THEN** the extracted CSS SHALL contain `box-shadow: 0 0 8px var(--current-bg)`

#### Scenario: Token manifest takes precedence

- **WHEN** a token key and contextual var have the same name (unlikely but possible)
- **THEN** the token manifest resolution SHALL take precedence over contextual var resolution

#### Scenario: Unknown contextual var falls through

- **WHEN** a value does not match any contextual var name or token key
- **THEN** it SHALL be passed through as a raw CSS value (existing behavior)

#### Scenario: Contextual var with opacity syntax

- **WHEN** a component has `borderColor: '{colors.current-bg/50}'`
- **THEN** the extracted CSS SHALL contain `border-color: color-mix(in srgb, var(--current-bg) 50%, transparent)`

#### Scenario: Rust resolver function signatures

- **WHEN** the contextual vars registry is loaded from theme data
- **THEN** it SHALL be accessible to `resolve_value`, `resolve_flat_styles`, and `resolve_single_alias` via a shared resolver context — not individual function parameters

### Requirement: Ordering constraint

`addContextualVars` SHALL only accept scales that already exist in the theme type. It MUST be called after the target scale is added (e.g., after `addColors` for the colors scale).

#### Scenario: Called after addColors

- **WHEN** `addContextualVars({ scale: 'colors', ... })` is called after `addColors()`
- **THEN** it SHALL compile and add phantom keys to the colors scale type

#### Scenario: Called before addColors

- **WHEN** `addContextualVars({ scale: 'colors', ... })` is called before `addColors()`
- **THEN** TypeScript SHALL produce a type error because `'colors'` is not yet in `keyof T`

#### Scenario: Runtime ordering guard

- **WHEN** `addContextualVars` is called with a scale name that does not exist at runtime
- **THEN** it SHALL throw an error: `"addContextualVars: scale 'X' not found — call addColors or addScale first"`
