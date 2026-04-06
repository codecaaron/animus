# selector-alias-registry Specification

## Purpose
TBD - created by archiving change selector-aliases. Update Purpose after archive.
## Requirements
### Requirement: Built-in selector alias set
The system SHALL ship a default set of `_`-prefixed selector aliases covering interactive pseudo-states, ARIA/data attribute states, pseudo-elements, and positional pseudo-classes. Each alias SHALL map to one or more CSS selectors.

#### Scenario: Interactive pseudo-state aliases resolve to CSS selectors
- **WHEN** a style object contains `_hover: { bg: 'primary' }`
- **THEN** the system emits `&:hover { background-color: var(--color-primary) }`

#### Scenario: Compound disabled alias targets multiple selectors
- **WHEN** a style object contains `_disabled: { opacity: '0.4' }`
- **THEN** the system emits rules for `&:disabled`, `&[disabled]`, `&[aria-disabled="true"]`, and `&[data-disabled]`, each containing `opacity: 0.4`

#### Scenario: ARIA state aliases resolve to data and aria attributes
- **WHEN** a style object contains `_expanded: { height: 'auto' }`
- **THEN** the system emits rules for `&[aria-expanded="true"]` and `&[data-expanded]`

### Requirement: Pseudo-element content auto-default
The system SHALL automatically inject `content: ''` for `_before` and `_after` alias blocks when the author does not provide an explicit `content` property. This auto-default SHALL NOT apply to raw `'&::before'` / `'&::after'` selector strings.

#### Scenario: Auto-default content for _before
- **WHEN** a style object contains `_before: { display: 'block', bg: 'primary', height: '2px' }`
- **THEN** the emitted CSS for `&::before` includes `content: ""`

#### Scenario: Explicit content overrides auto-default
- **WHEN** a style object contains `_after: { content: '"→"', color: 'accent' }`
- **THEN** the emitted CSS for `&::after` contains `content: "→"` and does NOT inject an additional `content: ""`

#### Scenario: Raw selector strings do not auto-default
- **WHEN** a style object contains `'&::before': { display: 'block', bg: 'primary' }`
- **THEN** the emitted CSS for `&::before` does NOT include `content: ""`

### Requirement: Prop shorthands resolve inside alias blocks
Prop shorthand keys (`bg`, `p`, `mt`, `mx`, etc.) SHALL resolve to their mapped CSS properties inside `_`-prefixed alias blocks, with full token reference support.

#### Scenario: Shorthand resolution in alias block
- **WHEN** a style object contains `_hover: { bg: 'surface', p: 16, borderColor: 'primary' }`
- **THEN** the emitted `&:hover` block contains `background-color: var(--color-surface)`, `padding: 1rem`, and `border-color: var(--color-primary)`

### Requirement: Aliases usable at every builder chain level
Selector aliases SHALL be recognized in style objects at every position in the builder chain: `.styles()`, `.variant()`, `.compound()`, `.states()`.

#### Scenario: Alias in variant style object
- **WHEN** a variant definition contains `danger: { borderColor: 'error', _hover: { borderColor: 'error.dark' } }`
- **THEN** the hover rule emits in `@layer variants` alongside the variant's base styles

#### Scenario: Alias in states style object
- **WHEN** a state definition contains `disabled: { opacity: '0.4', _hover: { cursor: 'not-allowed' } }`
- **THEN** the hover rule emits in `@layer states`

### Requirement: Layer placement follows chain position
The `@layer` for alias-emitted rules SHALL be determined by the builder chain method where the alias appears, NOT by the alias itself.

#### Scenario: Same alias in different chain positions emits in different layers
- **WHEN** `_hover: { bg: 'x' }` appears in `.styles()` AND `_hover: { bg: 'y' }` appears in `.variant()`
- **THEN** the first emits in `@layer base` and the second emits in `@layer variants`

### Requirement: User-extensible selector registry via addSelectors()
`createSystem()` SHALL provide an `addSelectors()` method that accepts a `Record<string, string>` mapping alias names to CSS selector strings. User-provided aliases SHALL merge with built-in defaults. User aliases SHALL override built-in aliases of the same name.

#### Scenario: Register a custom alias
- **WHEN** the system is configured with `.addSelectors({ _open: '&[data-state="open"]' })`
- **THEN** `_open: { display: 'block' }` in any style object emits `&[data-state="open"] { display: block }`

#### Scenario: Override a built-in alias
- **WHEN** the system is configured with `.addSelectors({ _disabled: '&:disabled, &[data-state="disabled"]' })`
- **THEN** `_disabled` uses the user-provided selector list instead of the built-in default

#### Scenario: Merged selector map available to extraction
- **WHEN** a system has custom selectors registered
- **THEN** the system manifest includes the full merged selector map for the extraction pipeline to consume

### Requirement: Raw selector strings remain supported
Raw `'&:...'` selector strings in style objects SHALL continue to work as before. Aliases are additive, not a replacement.

#### Scenario: Raw selector alongside alias
- **WHEN** a style object contains both `_hover: { color: 'primary' }` and `'&:focus-within': { outline: '2px solid' }`
- **THEN** both rules emit correctly in the same layer

