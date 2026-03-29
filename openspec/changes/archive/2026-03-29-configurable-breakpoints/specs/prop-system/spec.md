## MODIFIED Requirements

### Requirement: ParserProps parameterized by T
`ParserProps<Config, T>` SHALL thread T through to `Scale<Config, T>` → `ScaleValue<Config, T>` for each prop in the config. Responsive prop types SHALL use `ResponsiveProp<V>` where `ResponsiveProp` is `V | MediaQueryMap<V>`. `MediaQueryMap<V>` SHALL be `{ _?: V } & { [K in keyof T['breakpoints']]?: V }` — a mapped type derived from the theme's breakpoint keys, not a hardcoded interface.

#### Scenario: Parser props resolve scales from T
- **WHEN** a parser is created for a config with `{ bg: { property: 'backgroundColor', scale: 'colors' } }`
- **THEN** the parser's props type SHALL include `bg?: ResponsiveProp<keyof T['colors'] | CSSPropertyValue>`

#### Scenario: Responsive prop accepts only theme breakpoint keys
- **WHEN** T defines `breakpoints: { sm: number; lg: number }` and a parser prop accepts `ResponsiveProp<string>`
- **THEN** `{ _: 'red', sm: 'blue', lg: 'green' }` SHALL type-check but `{ md: 'blue' }` SHALL be a type error

## REMOVED Requirements

### Requirement: Responsive array syntax
**Reason:** Array syntax couples positional indices to a fixed breakpoint count. With user-defined breakpoint keys, positional ordering is ambiguous and fragile. Object syntax is key-based and naturally adapts to any breakpoint set.
**Migration:** Replace `p={[8, 12, , 16]}` with `p={{ _: 8, xs: 12, lg: 16 }}`. The `_` key replaces index 0 (default), named keys replace positional indices.

## ADDED Requirements

### Requirement: MediaQueryMap is a mapped type
`MediaQueryMap<T>` SHALL be defined as a mapped type over `Theme['breakpoints']` rather than a hardcoded interface. The shape SHALL be `{ _?: T } & { [K in keyof Theme['breakpoints']]?: T }`. When `Theme` is not augmented, it SHALL fall back to `{ _?: T } & { [key: string]: T | undefined }`.

#### Scenario: Mapped type reflects custom breakpoints
- **WHEN** Theme is augmented with `breakpoints: { mobile: number; tablet: number; desktop: number }`
- **THEN** `MediaQueryMap<string>` SHALL resolve to `{ _?: string; mobile?: string; tablet?: string; desktop?: string }`

#### Scenario: Fallback when Theme is not augmented
- **WHEN** Theme is NOT augmented
- **THEN** `MediaQueryMap<T>` SHALL accept any string key (open record), not restrict to `xs | sm | md | lg | xl`

### Requirement: ResponsiveProp simplified to two forms
`ResponsiveProp<T>` SHALL be `T | MediaQueryMap<T>`. The `MediaQueryArray<T>` union arm SHALL be removed entirely. No array-based responsive syntax SHALL be supported at the type level.

#### Scenario: Object syntax accepted
- **WHEN** a prop value is `{ _: 8, md: 16 }`
- **THEN** it SHALL type-check as `ResponsiveProp<number>` with the appropriate breakpoint keys

#### Scenario: Array syntax rejected
- **WHEN** a prop value is `[8, 12, , 16]`
- **THEN** it SHALL NOT type-check as `ResponsiveProp<number>` — arrays are no longer valid responsive values
