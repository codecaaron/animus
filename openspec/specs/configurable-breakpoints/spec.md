## Purpose

Requirements for the `configurable-breakpoints` capability: Breakpoint keys are user-defined; Breakpoint types flow through Theme augmentation; Breakpoint ordering is declaration order; and 1 more.

## Requirements

### Requirement: Breakpoint keys are user-defined

`createTheme()` SHALL accept a `breakpoints` object with arbitrary string keys and numeric pixel values. The keys defined in this object SHALL become the complete set of valid responsive breakpoint identifiers throughout the type system, runtime, and extraction pipeline. No hardcoded breakpoint key set SHALL exist anywhere in the system.

#### Scenario: Custom breakpoint keys

- **WHEN** a consumer defines `createTheme({ breakpoints: { mobile: 480, tablet: 768, desktop: 1024 } })`
- **THEN** responsive props SHALL accept `{ _: value, mobile: value, tablet: value, desktop: value }` and no other breakpoint keys

#### Scenario: Fewer breakpoints than default

- **WHEN** a consumer defines `createTheme({ breakpoints: { sm: 640, lg: 1024 } })`
- **THEN** responsive props SHALL accept only `{ _: value, sm: value, lg: value }` — keys like `xs`, `md`, `xl` SHALL be type errors

#### Scenario: More breakpoints than default

- **WHEN** a consumer defines `createTheme({ breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440, xxl: 1920 } })`
- **THEN** responsive props SHALL accept all six keys plus `_`

#### Scenario: The `_` key is always valid

- **WHEN** a consumer uses `{ _: value }` in a responsive prop
- **THEN** the `_` key SHALL be accepted regardless of what breakpoint keys are defined — it represents the default (no media query) value

### Requirement: Breakpoint types flow through Theme augmentation

The augmented `Theme` interface SHALL carry the user's breakpoint definition. `MediaQueryMap<T>` SHALL be a mapped type derived from `Theme['breakpoints']`, not a hardcoded interface. When consumers augment `Theme` via `declare module`, responsive prop types SHALL automatically reflect their breakpoint keys.

#### Scenario: Augmented Theme drives responsive types

- **WHEN** a consumer augments Theme with `interface Theme extends MyTheme {}` where MyTheme has `breakpoints: { sm: number; lg: number }`
- **THEN** `ResponsiveProp<string>` SHALL resolve to `string | { _?: string; sm?: string; lg?: string }`

#### Scenario: Unaugmented Theme falls back to open keys

- **WHEN** Theme is NOT augmented (default `BaseTheme`)
- **THEN** `ResponsiveProp<T>` SHALL accept `T | { _?: T; [key: string]: T | undefined }` — any string key is valid (no type narrowing without augmentation)

### Requirement: Breakpoint ordering is declaration order

Media queries SHALL be emitted in the order the breakpoint keys appear in the `breakpoints` object. Since JavaScript objects preserve insertion order for string keys, the consumer controls the cascade order by controlling the object literal order.

#### Scenario: Mobile-first ordering

- **WHEN** breakpoints are `{ sm: 640, md: 1024, lg: 1440 }`
- **THEN** generated media queries SHALL appear in order: `@media (min-width: 640px)`, `@media (min-width: 1024px)`, `@media (min-width: 1440px)`

#### Scenario: Order matters for cascade

- **WHEN** a responsive prop specifies `{ sm: 'red', lg: 'blue' }` and `lg` comes after `sm` in the breakpoints definition
- **THEN** the `@media (min-width: lg)` rule SHALL appear after the `@media (min-width: sm)` rule in the CSS output, ensuring the larger breakpoint wins at wider viewports

### Requirement: createTheme validates breakpoint values

`createTheme()` SHALL validate that all breakpoint values are positive numbers. Non-numeric or negative values SHALL throw at theme build time.

#### Scenario: Non-numeric value rejected

- **WHEN** a consumer passes `createTheme({ breakpoints: { sm: '768px' } })`
- **THEN** `createTheme` SHALL throw an error indicating breakpoint values must be numbers (pixel values)

#### Scenario: Zero is valid

- **WHEN** a consumer passes `createTheme({ breakpoints: { base: 0, sm: 640 } })`
- **THEN** the breakpoints SHALL be accepted — a breakpoint at 0px is valid (equivalent to default/mobile-first)
