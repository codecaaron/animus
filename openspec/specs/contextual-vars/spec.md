## Purpose

Requirements for the `contextual-vars` capability: ThemeBuilder addContextualVars method; Phantom type merging; Contextual var serialization; and 2 more.
## Requirements
### Requirement: Phantom type merging

Contextual var names SHALL exist as keys in the scale's type but SHALL NOT exist as values in the runtime theme object. They are type-only (phantom) members.

#### Scenario: Type includes phantom keys

- **WHEN** `declareContextualVars` adds `'current-bg'` to the colors scale
- **THEN** `'current-bg'` SHALL be a valid value for any prop with `scale: 'colors'` (e.g., `bg`, `color`, `borderColor`, `fill`)

#### Scenario: Runtime theme unchanged

- **WHEN** `declareContextualVars` is called
- **THEN** the runtime theme object passed to `#checkpoint` SHALL be identical to the theme before the call — no new keys added to the runtime object

#### Scenario: Phantom keys do not appear in manifest

- **WHEN** the theme is serialized via `.build()` and the manifest is generated
- **THEN** contextual var names SHALL NOT appear in the `_variables` or token manifest as emitted tokens

### Requirement: Contextual var serialization

The theme serialization SHALL include a `contextualVars` registry mapping scale names to readonly arrays of contextual var names (names only; each CSS custom property is derived as `--{name}` at consumption time).

#### Scenario: Serialized output includes registry

- **WHEN** the theme has `.declareContextualVars({ colors: ['current-bg'] })`
- **THEN** the serialized contextual-vars registry SHALL contain `{ "colors": ["current-bg"] }`

#### Scenario: Registry available to Rust extractor

- **WHEN** the vite plugin evaluates the theme and passes data to the Rust extractor
- **THEN** the contextual var registry SHALL be included in the serialized theme data alongside `scalesJson` and `variableMapJson`

#### Scenario: Rust resolver function signatures

- **WHEN** the contextual vars registry is loaded from theme data
- **THEN** it SHALL be accessible to `resolve_value`, `resolve_flat_styles`, and `resolve_single_alias` via a shared resolver context — not individual function parameters

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

`declareContextualVars` SHALL only accept scales that already exist in the theme type. It MUST be called after the target scale is added (e.g., after `addColors` for the colors scale).

#### Scenario: Called after addColors

- **WHEN** `declareContextualVars({ colors: [...] })` is called after `addColors()`
- **THEN** it SHALL compile and add phantom keys to the colors scale type

#### Scenario: Called before addColors

- **WHEN** `declareContextualVars({ colors: [...] })` is called before the colors scale exists on the theme type
- **THEN** TypeScript SHALL produce a type error on the scale key

#### Scenario: Runtime ordering guard

- **WHEN** `declareContextualVars` is called with a scale name that does not exist at runtime
- **THEN** it SHALL throw an error: `"declareContextualVars: scale 'X' not found — call addColors or addScale first"`

### Requirement: ThemeBuilder declareContextualVars method

The ThemeBuilder SHALL provide a `declareContextualVars` method that declares phantom scale members resolving to CSS custom properties. The method SHALL accept a map from existing scale names (`keyof T`) to readonly arrays of contextual var names, with each var's CSS custom property derived as `--{name}`; it SHALL accept an optional second argument of per-var `@property` registration metadata whose keys are constrained to the declared var names. Var names SHALL narrow to literal types without requiring `as const` at the callsite.

#### Scenario: Basic contextual var declaration

- **WHEN** the theme chain calls `.declareContextualVars({ colors: ['current-bg'] })`
- **THEN** `keyof TokenScales<Theme>['colors']` SHALL include `'current-bg'`
- **AND** existing color keys SHALL remain unchanged

#### Scenario: Multiple contextual vars on one scale

- **WHEN** the theme chain calls `.declareContextualVars({ colors: ['current-bg', 'current-border-color'] })`
- **THEN** `keyof TokenScales<Theme>['colors']` SHALL include both `'current-bg'` and `'current-border-color'`

#### Scenario: Type narrowing without as const

- **WHEN** a user writes `.declareContextualVars({ colors: ['current-bg'] })` without `as const`
- **THEN** the var names SHALL be inferred as literal string types, not widened to `string`

#### Scenario: Scale must exist

- **WHEN** `.declareContextualVars({ bogus: ['x'] })` is called with a scale not in `keyof T`
- **THEN** TypeScript SHALL produce a type error on the scale key

#### Scenario: Chainable with checkpoint

- **WHEN** `.declareContextualVars()` is called in the builder chain
- **THEN** it SHALL return a new `ThemeBuilder` instance via `#checkpoint` with the widened type
- **AND** subsequent chain methods SHALL see the updated type

