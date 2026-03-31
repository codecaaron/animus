## ADDED Requirements

### Requirement: Color token ref type acceptance
Properties whose scale is `'colors'` SHALL accept string values containing `{colors.X}` token reference patterns in addition to color scale keys. The type `ColorTokenRef` SHALL be defined as `` `${string}{colors.${string}}${string}` `` and SHALL be unioned into the resolved type for color-scale properties.

#### Scenario: Standalone color token ref
- **WHEN** a color-scale property value is `"{colors.ember}"`
- **THEN** the TypeScript compiler SHALL accept it without error

#### Scenario: Color token ref with alpha modifier
- **WHEN** a color-scale property value is `"{colors.ember/40}"`
- **THEN** the TypeScript compiler SHALL accept it without error

#### Scenario: Color token ref in compound value
- **WHEN** a color-scale property value is `"linear-gradient(90deg, {colors.ember}, {colors.spark})"`
- **THEN** the TypeScript compiler SHALL accept it without error

#### Scenario: Raw CSS color function rejected
- **WHEN** a color-scale property value is `"rgba(255,0,0,0.1)"` and the theme has a non-empty colors scale
- **THEN** the TypeScript compiler SHALL report a type error

#### Scenario: Scale keys still narrowed
- **WHEN** a theme defines `colors: { primary, ember, spark }` and a color-scale property is used
- **THEN** the accepted type SHALL include `'primary' | 'ember' | 'spark'` with autocomplete support

### Requirement: Token refs rejected on non-color scales
Properties whose scale is NOT `'colors'` SHALL NOT accept `{colors.X}` or any token reference syntax at the type level. Scale-bound properties for space, shadows, fonts, etc. SHALL accept only their scale keys and CSS property values.

#### Scenario: Space prop rejects token ref
- **WHEN** a prop with `scale: 'space'` receives value `"{space.4}"`
- **THEN** the TypeScript compiler SHALL report a type error

#### Scenario: Shadow prop rejects inline token ref
- **WHEN** a prop with `scale: 'shadows'` receives value `"0 0 8px {colors.ember/40}"`
- **THEN** the TypeScript compiler SHALL report a type error (shadow values with token refs belong in the theme scale)
