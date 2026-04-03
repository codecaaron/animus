# css-property-data Specification

## Purpose
Provide a shared, dependency-free package (`@animus-ui/properties`) that exports CSS property data constants (unitless property set, shorthand property list) and re-exports csstype definitions, serving as the single source of truth for property metadata across the monorepo.

## Requirements
### Requirement: Unitless property set
`@animus-ui/properties` SHALL export a `UNITLESS_PROPERTIES` constant of type `Set<string>` containing all CSS properties that accept bare numeric values without a unit suffix.

#### Scenario: Contains standard unitless properties
- **WHEN** the consumer checks `UNITLESS_PROPERTIES.has('opacity')`
- **THEN** the result SHALL be `true`

#### Scenario: Contains SVG unitless properties
- **WHEN** the consumer checks `UNITLESS_PROPERTIES.has('fill-opacity')`
- **THEN** the result SHALL be `true`

#### Scenario: Contains legacy flexbox unitless properties
- **WHEN** the consumer checks `UNITLESS_PROPERTIES.has('box-flex')`, `box-flex-group`, `box-ordinal-group`, or `flex-order`
- **THEN** the result SHALL be `true` for all four

#### Scenario: Contains modern unitless properties
- **WHEN** the consumer checks `UNITLESS_PROPERTIES.has('aspect-ratio')` or `UNITLESS_PROPERTIES.has('scale')`
- **THEN** the result SHALL be `true` for both

#### Scenario: Length properties excluded
- **WHEN** the consumer checks `UNITLESS_PROPERTIES.has('padding')`
- **THEN** the result SHALL be `false`

#### Scenario: Property names in kebab-case
- **WHEN** the consumer iterates `UNITLESS_PROPERTIES`
- **THEN** all entries SHALL use kebab-case naming (e.g., `animation-iteration-count`, not `animationIterationCount`)

### Requirement: Shorthand property list
`@animus-ui/properties` SHALL export a `SHORTHAND_PROPERTIES` constant of type `readonly string[]` containing CSS shorthand property names used for declaration ordering.

#### Scenario: Contains standard shorthands
- **WHEN** the consumer checks `SHORTHAND_PROPERTIES.includes('border')`
- **THEN** the result SHALL be `true`

#### Scenario: Contains layout shorthands
- **WHEN** the consumer checks for `flex`, `grid`, `gap`, `margin`, `padding`
- **THEN** all SHALL be present in `SHORTHAND_PROPERTIES`

#### Scenario: Property names in camelCase
- **WHEN** the consumer reads `SHORTHAND_PROPERTIES`
- **THEN** entries SHALL use camelCase naming (e.g., `borderTop`, not `border-top`), matching prop config convention

#### Scenario: No duplicate entries
- **WHEN** the consumer checks `SHORTHAND_PROPERTIES` for duplicates
- **THEN** every entry SHALL appear exactly once

#### Scenario: Scoped to registered shorthands
- **WHEN** the consumer reads `SHORTHAND_PROPERTIES`
- **THEN** it SHALL contain shorthands registered in prop configs (border, margin, padding, flex, grid, etc.), not all possible CSS shorthands

### Requirement: csstype re-export
`@animus-ui/properties` SHALL re-export CSS property type definitions from `csstype`, providing a single augmentation point for property types across the monorepo.

#### Scenario: Full type surface importable
- **WHEN** a consumer imports `type { Properties, Property, Pseudos } from '@animus-ui/properties'`
- **THEN** all SHALL resolve to their `csstype` equivalents via wildcard re-export

#### Scenario: Single dependency point
- **WHEN** a package needs CSS property type definitions
- **THEN** it SHALL depend on `@animus-ui/properties` instead of depending on `csstype` directly

### Requirement: Zero internal dependencies
`@animus-ui/properties` SHALL have zero dependencies on other `@animus-ui/*` packages. Its only external dependency SHALL be `csstype`.

#### Scenario: Package dependency graph
- **WHEN** the package.json dependencies are inspected
- **THEN** no `@animus-ui/*` packages SHALL appear in `dependencies` or `peerDependencies`
