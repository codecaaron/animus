## ADDED Requirements

### Requirement: AnimusConfig registers named prop groups
AnimusConfig SHALL provide an `addGroup(name, config)` method that registers a named group of prop definitions. Each group SHALL map prop shorthand names to CSS property configurations (property, properties, scale, transform). The `.build()` method SHALL produce an Animus instance with the full registry.

#### Scenario: Adding a space group
- **WHEN** `createAnimus().addGroup('space', { p: { property: 'padding', scale: 'space' }, m: { property: 'margin', scale: 'space' } })` is called
- **THEN** the resulting Animus instance SHALL recognize `p` and `m` as system props that map to padding and margin respectively, with values resolved from the theme's `space` scale

#### Scenario: Groups are selectively enabled
- **WHEN** a component uses `.groups({ space: true, color: true })`
- **THEN** only props from the `space` and `color` groups SHALL be available on the component's prop API, and props from other groups (e.g., `typography`) SHALL NOT be accepted

### Requirement: Prop definitions support scale resolution
Each prop definition SHALL support a `scale` field that references a theme scale name (e.g., `'colors'`, `'space'`, `'fontSizes'`). When a prop value is provided, the system SHALL look up the value in the corresponding theme scale via `lookupScaleValue(value, scale, theme)`.

#### Scenario: String value resolved from theme scale
- **WHEN** a prop `bg` has `scale: 'colors'` and the component receives `bg="primary"`
- **THEN** the system SHALL resolve `theme.colors.primary` (which may be a CSS variable reference like `var(--color-primary)`) and use that as the CSS value

#### Scenario: Value not in scale passes through
- **WHEN** a prop `bg` has `scale: 'colors'` and the component receives `bg="#ff0000"`
- **THEN** the system SHALL use `#ff0000` directly as the CSS value (passthrough for non-scale values)

### Requirement: Prop definitions support transform functions
Each prop definition SHALL support a `transform` field containing a transform function that converts prop values to CSS values. Transforms SHALL run AFTER scale resolution. The transform field SHALL accept both `NamedTransform` (created via `createTransform`) and bare `TransformFn` functions. `NamedTransform` is the canonical form for extraction compatibility.

#### Scenario: Size transform converts numbers
- **WHEN** a prop `width` has `transform: size` (where `size` is a `NamedTransform` with `.transformName === 'size'`) and receives value `0.5`
- **THEN** the transform SHALL convert `0.5` to `'50%'` (fractional numbers 0-1 become percentages)

#### Scenario: Size transform handles pixels
- **WHEN** a prop `width` has `transform: size` and receives value `100`
- **THEN** the transform SHALL convert `100` to `'100px'` (numbers > 1 become pixel values)

#### Scenario: Size transform passes strings through
- **WHEN** a prop `width` has `transform: size` and receives value `'auto'`
- **THEN** the transform SHALL return `'auto'` unchanged

#### Scenario: NamedTransform is callable at runtime
- **WHEN** `createPropertyStyle` encounters a `NamedTransform` in a prop config's `transform` field
- **THEN** it SHALL call `transform(value, property, props)` directly — the `NamedTransform` is a callable function, no special handling needed

#### Scenario: Bare function still works at runtime
- **WHEN** a prop config uses a bare function `transform: (v) => `${v}px`` (no `createTransform` wrapper)
- **THEN** the runtime SHALL call it identically — `createPropertyStyle` does not distinguish between `NamedTransform` and bare `TransformFn`

### Requirement: Props support multi-property mapping
A single prop definition SHALL support mapping to multiple CSS properties via a `properties` array field. When a prop maps to multiple properties, the resolved value SHALL be applied to ALL listed properties.

#### Scenario: px maps to paddingLeft and paddingRight
- **WHEN** a prop `px` has `properties: ['paddingLeft', 'paddingRight']` and receives value `16`
- **THEN** both `paddingLeft` and `paddingRight` SHALL be set to the resolved value

### Requirement: Responsive value syntax
Props SHALL support responsive values in two forms: array syntax and object syntax. Array syntax maps positionally to breakpoints `[default, xs, sm, md, lg, xl]`. Object syntax uses named keys `{ _: default, xs, sm, md, lg, xl }`. Both forms SHALL generate equivalent `@media` queries.

#### Scenario: Array responsive syntax
- **WHEN** a component receives `p={[8, 12, , 16]}` (note: sparse array with gap)
- **THEN** the system SHALL generate: base `padding: 8`, `@media (min-width: xs) { padding: 12 }`, `@media (min-width: md) { padding: 16 }` — skipping the undefined sm breakpoint

#### Scenario: Object responsive syntax
- **WHEN** a component receives `p={{ _: 8, sm: 16 }}`
- **THEN** the system SHALL generate: base `padding: 8`, `@media (min-width: sm) { padding: 16 }`

#### Scenario: Responsive values in style definitions
- **WHEN** `.styles({ padding: { _: '1rem', sm: '2rem' } })` is used in the builder chain
- **THEN** the responsive breakpoints SHALL be generated at the base styles cascade layer

### Requirement: Prop ordering respects CSS shorthand cascade
The parser SHALL order prop evaluation so that shorthand properties are processed BEFORE their longhand equivalents. This ensures that longhand values override shorthand values in the generated CSS output, matching native CSS cascade behavior.

#### Scenario: Shorthand before longhand
- **WHEN** a component receives both `p={8}` (shorthand for all padding) and `pt={16}` (longhand for padding-top)
- **THEN** `padding: 8` SHALL be emitted before `padding-top: 16` in the CSS output, ensuring padding-top overrides the shorthand

