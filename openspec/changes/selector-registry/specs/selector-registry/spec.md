## ADDED Requirements

### Requirement: Selector registry definition
The system builder SHALL accept a `.withSelectors()` method that takes a `Record<string, string>` mapping shorthand names to CSS attribute selector strings. The keys are shorthand names (e.g., `open`, `disabled`). The values are CSS attribute selectors WITHOUT the `&` prefix (e.g., `[data-state="open"]`, `[disabled]`).

#### Scenario: Register selectors on system
- **WHEN** consumer calls `.withSelectors({ open: '[data-state="open"]', closed: '[data-state="closed"]', disabled: '[disabled]' })`
- **THEN** the system SHALL store the selector map and make it available via serialization

#### Scenario: Empty registry is valid
- **WHEN** consumer calls `.withSelectors({})`
- **THEN** the system SHALL accept the empty map with no errors

#### Scenario: Omitting withSelectors is valid
- **WHEN** consumer does not call `.withSelectors()` in the builder chain
- **THEN** the system SHALL operate with an empty selector registry (no shorthand expansion)

### Requirement: Selector shorthand expansion in style objects
Registered selector shorthands SHALL be usable as style object keys in the form `'&:name'` where `name` exactly matches a registered selector key. At extraction time, `'&:name'` SHALL be expanded to `'&${registeredValue}'`.

#### Scenario: Shorthand expands in .styles()
- **WHEN** `open` is registered as `[data-state="open"]` and a component has `.styles({ '&:open': { maxHeight: '500px' } })`
- **THEN** the extracted CSS SHALL contain `&[data-state="open"] { max-height: 500px; }` within `@layer base`

#### Scenario: Shorthand expands in .variant()
- **WHEN** `disabled` is registered as `[disabled]` and a variant contains `{ '&:disabled': { opacity: '0.4' } }`
- **THEN** the extracted CSS SHALL contain `&[disabled] { opacity: 0.4; }` within `@layer variants`

#### Scenario: Shorthand expands in .states()
- **WHEN** `active` is registered as `[data-active]` and a state contains `{ '&:active': { borderColor: 'primary' } }`
- **THEN** the extracted CSS SHALL contain `&[data-active] { border-color: var(--colors-primary); }` within `@layer states`

#### Scenario: Unregistered name passes through
- **WHEN** `hover` is NOT a registered selector and a style object contains `'&:hover': { color: 'primary' }`
- **THEN** the extracted CSS SHALL contain `&:hover { color: var(--colors-primary); }` — standard CSS pseudo-class, no expansion

#### Scenario: Nested shorthand expansion
- **WHEN** `open` and `disabled` are both registered and a style object contains `'&:open': { '&:disabled': { opacity: '0.3' } }`
- **THEN** the extracted CSS SHALL expand both: `&[data-state="open"] { &[disabled] { opacity: 0.3; } }`

### Requirement: Single-segment expansion only
Selector shorthand expansion SHALL match only when the ENTIRE segment after `&:` matches a registered key. Multi-segment compound selectors (e.g., `'&:open:disabled'`) SHALL NOT auto-expand individual segments.

#### Scenario: Compound selector not auto-expanded
- **WHEN** both `open` and `disabled` are registered and a style object contains `'&:open:disabled': { opacity: '0.3' }`
- **THEN** `open:disabled` SHALL NOT match any registered key (no key named `open:disabled` exists) and SHALL pass through as a raw CSS selector `&:open:disabled`

#### Scenario: Nesting achieves compound targeting
- **WHEN** consumer needs to target `[data-state="open"][disabled]`
- **THEN** they SHALL use nesting: `'&:open': { '&:disabled': { ... } }` — each level expands independently

### Requirement: Type-safe selector autocomplete
Registered selector names SHALL appear in style object key autocomplete via a `SelectorKeys` mapped type that produces `'&:${keyof Selectors}'` unions.

#### Scenario: Autocomplete shows registered selectors
- **WHEN** consumer types `'&:'` in a style object and selectors `open`, `closed`, `disabled` are registered
- **THEN** TypeScript autocomplete SHALL suggest `'&:open'`, `'&:closed'`, `'&:disabled'`

#### Scenario: Arbitrary selectors remain valid
- **WHEN** consumer writes `'&:hover': { ... }` or `'&[custom-attr]': { ... }` in a style object
- **THEN** the type system SHALL accept these — selector keys are a union of registered shorthands AND arbitrary strings, not exclusive
