## MODIFIED Requirements

### Requirement: Rust contextual var resolution
The Rust extractor SHALL resolve contextual var names to their CSS custom property values when encountered as style values. When a namespace prefix is configured, the emitted `var()` reference SHALL use the prefixed custom property name.

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

#### Scenario: Prefix-aware contextual var emission
- **WHEN** a component has `borderColor: 'current-bg'` and `current-bg` is in contextual vars for `colors`
- **AND** the resolve context has `prefix: Some("ax")`
- **THEN** the extracted CSS SHALL contain `border-color: var(--ax-current-bg)`

#### Scenario: Prefix-aware token ref syntax
- **WHEN** a component has `boxShadow: '0 0 8px {colors.current-bg}'`
- **AND** the resolve context has `prefix: Some("ax")`
- **THEN** the extracted CSS SHALL contain `box-shadow: 0 0 8px var(--ax-current-bg)`
