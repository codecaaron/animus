## MODIFIED Requirements

### Requirement: Token alias opacity modifier
The system SHALL resolve `{scale.path/opacity}` syntax to `color-mix(in srgb, {resolved} {opacity}%, transparent)` in all resolution contexts: Rust crate extraction, pipeline `resolveTokenAliases`, AND theme-level `resolveTokenRefs`.

#### Scenario: Opacity modifier in theme scale cross-reference
- **WHEN** a theme scale value contains `{colors.primary/40}` and `colors.primary` resolves to a raw value (non-emitted scale)
- **THEN** `resolveTokenRefs` SHALL produce `color-mix(in srgb, #6366f1 40%, transparent)` (not the raw color without opacity)

#### Scenario: Opacity modifier with var() reference in theme scale
- **WHEN** a theme scale value contains `{colors.primary/40}` and `colors.primary` resolves to `var(--color-primary)` (emitted scale)
- **THEN** `resolveTokenRefs` SHALL produce `color-mix(in srgb, var(--color-primary) 40%, transparent)`

#### Scenario: Zero opacity
- **WHEN** a theme scale value contains `{colors.primary/0}`
- **THEN** `resolveTokenRefs` SHALL produce `transparent`
