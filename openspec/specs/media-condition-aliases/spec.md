# media-condition-aliases Specification

## Purpose
TBD - created by archiving change modern-css-surface. Update Purpose after archive.
## Requirements
### Requirement: Raw media query block keys

Style objects SHALL accept raw `@media` query strings as block keys beyond breakpoint-derived min-width queries — including media-feature queries (`prefers-*`), print, max-width, and range syntax — and each SHALL emit a matching `@media` rule wrapping the component's class selector inside the owning `@layer` block.

#### Scenario: Reduced motion query

- **WHEN** a style object contains `'@media (prefers-reduced-motion: reduce)': { transition: 'none' }`
- **THEN** the emitted CSS contains `@media (prefers-reduced-motion: reduce) { .ClassName { transition: none; } }`

#### Scenario: Print query

- **WHEN** a style object contains `'@media print': { display: 'none' }`
- **THEN** the emitted CSS contains `@media print { .ClassName { display: none; } }`

#### Scenario: Range syntax query

- **WHEN** a style object contains `'@media (400px <= width < 800px)': { gap: 8 }`
- **THEN** the emitted CSS contains `@media (400px <= width < 800px) { .ClassName { gap: 0.5rem; } }`

### Requirement: Built-in media-feature condition aliases

The system SHALL ship a default set of `_`-prefixed media-feature condition aliases covering motion, print, orientation, contrast, and OS color-scheme preferences: `_motionReduce`, `_motionSafe`, `_print`, `_portrait`, `_landscape`, `_moreContrast`, `_lessContrast`, `_osDark`, `_osLight`. Each SHALL map to its corresponding media-feature query.

#### Scenario: Built-in motion alias

- **WHEN** a style object contains `_motionReduce: { transition: 'none' }` with no user condition registrations
- **THEN** the emitted CSS contains `@media (prefers-reduced-motion: reduce) { .ClassName { transition: none; } }`

#### Scenario: Built-in OS color-scheme alias

- **WHEN** a style object contains `_osDark: { colorScheme: 'dark' }`
- **THEN** the emitted CSS contains `@media (prefers-color-scheme: dark) { .ClassName { color-scheme: dark; } }`

#### Scenario: Built-in print alias

- **WHEN** a style object contains `_print: { display: 'none' }`
- **THEN** the emitted CSS contains `@media print { .ClassName { display: none; } }`

### Requirement: Registered media condition aliases

Condition aliases registered with a `@media` value SHALL resolve as `_`-prefixed block keys to the registered media query.

#### Scenario: Media alias in a style object

- **WHEN** the system is configured with `.addConditions({ _motionReduce: '@media (prefers-reduced-motion: reduce)' })` and a style object contains `_motionReduce: { animation: 'none' }`
- **THEN** the emitted CSS contains `@media (prefers-reduced-motion: reduce) { .ClassName { animation: none; } }`

#### Scenario: Token resolution inside alias blocks

- **WHEN** a style object contains `_motionReduce: { bg: 'surface' }` with `_motionReduce` registered as a media condition alias
- **THEN** the emitted media rule contains `background-color: var(--color-surface)`

### Requirement: Condition blocks recognized at every chain level

Condition blocks — registered aliases and raw at-rule keys — SHALL be recognized in style objects at every builder chain position (`.styles()`, `.variant()`, `.compound()`, `.states()`), and the `@layer` for condition-emitted rules SHALL follow the chain position where the block appears.

#### Scenario: Condition block in a variant

- **WHEN** a variant definition contains `compact: { p: 4, '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }`
- **THEN** the media rule for the variant's class emits in the variants layer alongside the variant's base styles

### Requirement: Condition authoring is block-position only

Condition aliases and raw at-rule keys SHALL be recognized only in block position. Value-position maps SHALL continue to admit only `_` and theme breakpoint keys, and a value-position object containing condition-alias keys SHALL NOT produce a condition-wrapped rule.

#### Scenario: Breakpoint value maps unchanged

- **WHEN** a style object contains `fontSize: { _: 14, sm: 16 }`
- **THEN** the emitted CSS contains the default declaration and a min-width media rule for `sm`, identical in shape to existing responsive emission

#### Scenario: Condition alias in value position produces no media rule

- **WHEN** a style object contains `fontSize: { _motionReduce: 12 }`
- **THEN** no `@media` rule is emitted for that value

### Requirement: Breakpoint value maps on pass-through CSS properties

Value-position breakpoint maps SHALL be accepted — at the type level and in emission — on pass-through CSS properties (properties not registered in the system's propConfig but typable as themed CSS props), with emission identical in shape to registered-prop responsive emission.

#### Scenario: Responsive map on a pass-through property

- **WHEN** a style object contains `outlineWidth: { _: '1px', sm: '2px' }` and `outlineWidth` is not registered in propConfig
- **THEN** the style object typechecks
- **AND** the emitted CSS contains `outline-width: 1px;` in the base rule and `outline-width: 2px;` in the `sm` min-width media rule

#### Scenario: Pass-through responsive slot values emit as authored

- **WHEN** a style object contains `outlineColor: { _: '{colors.primary}', sm: 'rebeccapurple' }`
- **THEN** the delimited token reference resolves to its `var(--color-…)` reference and the literal CSS color ships verbatim — responsive slots on pass-through properties carry values exactly as the same values would emit in plain position

