## MODIFIED Requirements

### Requirement: Unit fallback function
Extract SHALL export an `applyUnitFallback()` function. The function SHALL import the unitless property set from `@animus-ui/properties` rather than defining it inline.

#### Scenario: Bare numerics get px suffix
- **WHEN** CSS contains `padding: 16` (bare numeric on a length property)
- **THEN** the output SHALL contain `padding: 16px`

#### Scenario: Unitless properties preserved
- **WHEN** CSS contains `opacity: 0.5` or `z-index: 100`
- **THEN** the output SHALL NOT add a px suffix

#### Scenario: Unitless set sourced from properties package
- **WHEN** `applyUnitFallback` checks whether a property is unitless
- **THEN** it SHALL use `UNITLESS_PROPERTIES` imported from `@animus-ui/properties`, not an inline definition
