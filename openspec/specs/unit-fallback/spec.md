# unit-fallback Specification

## Purpose

TBD - created by archiving change scale-miss-fallback. Update Purpose after archive.

## Requirements

### Requirement: Bare numeric values receive px on length properties

When the CSS post-processing step encounters a bare numeric value (no unit suffix) in a CSS declaration for a property that expects length units, it SHALL append `px` to the value.

#### Scenario: Padding with bare number

- **WHEN** extracted CSS contains `padding:8;`
- **THEN** post-processing SHALL produce `padding:8px;`

#### Scenario: Margin with bare negative number

- **WHEN** extracted CSS contains `margin-top:-16;`
- **THEN** post-processing SHALL produce `margin-top:-16px;`

#### Scenario: Font size with bare decimal

- **WHEN** extracted CSS contains `font-size:1.5;`
- **THEN** post-processing SHALL produce `font-size:1.5px;`

#### Scenario: Value already has units

- **WHEN** extracted CSS contains `padding:0.5rem;`
- **THEN** post-processing SHALL NOT modify the value

### Requirement: Unitless properties are preserved

Properties in the unitless set SHALL NOT receive `px` suffix. The unitless set SHALL be imported from `@animus-ui/properties` — both the build-time pipeline (`applyUnitFallback`) and the runtime dynamic path (`resolveClasses`) SHALL reference the same `UNITLESS_PROPERTIES` export. No inline definitions.

#### Scenario: Line height preserved

- **WHEN** extracted CSS contains `line-height:1.5;`
- **THEN** post-processing SHALL NOT modify the value (line-height accepts unitless numbers)

#### Scenario: Opacity preserved

- **WHEN** extracted CSS contains `opacity:0.5;`
- **THEN** post-processing SHALL NOT modify the value

#### Scenario: Font weight preserved

- **WHEN** extracted CSS contains `font-weight:700;`
- **THEN** post-processing SHALL NOT modify the value

#### Scenario: Z-index preserved

- **WHEN** extracted CSS contains `z-index:10;`
- **THEN** post-processing SHALL NOT modify the value

#### Scenario: Flex preserved

- **WHEN** extracted CSS contains `flex:1;`
- **THEN** post-processing SHALL NOT modify the value

#### Scenario: Single source of truth

- **WHEN** both `extract/pipeline/unit-fallback.ts` and `system/src/runtime/resolveClasses.ts` need the unitless property set
- **THEN** both SHALL import `UNITLESS_PROPERTIES` from `@animus-ui/properties` — no inline Set definitions

### Requirement: Shorthand values handled per-number

When a CSS declaration contains multiple bare numeric values (shorthand properties), each numeric value SHALL be independently checked and receive `px` if the property is not unitless.

#### Scenario: Margin shorthand

- **WHEN** extracted CSS contains `margin:8 16;`
- **THEN** post-processing SHALL produce `margin:8px 16px;`
