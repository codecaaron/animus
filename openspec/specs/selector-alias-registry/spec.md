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

#### Scenario: Auto-default content for \_before

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

### Requirement: Theme scale resolution inside selector-alias blocks for pass-through CSS props

Inside `_`-prefixed selector-alias blocks nested within `.styles({...})` (e.g. `_hover`, `_focusVisible`, `_selected`), theme-scale-typed string values on pass-through CSS properties SHALL resolve via the theme scales to their CSS variable references. Pass-through CSS properties are CSS properties not registered in the system's propConfig but typable via `ThemedCSSProps` (e.g. `outlineColor`, `caretColor`, `accentColor`). Resolution SHALL use the scale appropriate to the CSS property family (color-family properties → `colors` scale; length properties → `space` scale; etc.).

This requirement exists because propConfig-registered props (e.g. `color`, `bg`) already resolve inside aliased blocks via the existing scale-lookup pathway. Pass-through props were previously emitted as literal unresolved scale keys (e.g. `outline-color: primary;` instead of `outline-color: var(--color-primary);`), producing invalid CSS that silently fails in browsers despite typechecking via `ThemedCSSProps`.

#### Scenario: outlineColor inside \_focusVisible resolves via colors scale

- **WHEN** a style object contains `_focusVisible: { outlineColor: 'primary' }` and the theme defines `colors.primary`
- **THEN** the emitted CSS for `&:focus-visible` contains `outline-color: var(--color-primary)` — NOT the literal `outline-color: primary;`

#### Scenario: Pass-through color prop outside aliased block unaffected

- **WHEN** a style object contains `{ outlineColor: 'primary' }` at the top level (no alias block)
- **THEN** the emitted CSS contains `outline-color: var(--color-primary)` — existing behavior preserved, this requirement does not regress top-level resolution

#### Scenario: Unknown scale key inside alias emits literal

- **WHEN** a style object contains `_focusVisible: { outlineColor: 'not-a-scale-key' }` and the theme does NOT define `colors.not-a-scale-key`
- **THEN** the emitted CSS contains `outline-color: not-a-scale-key;` — bare unresolvable scale keys pass through as literals (consistent with the existing pass-through behavior for unknown keys at the top level)

#### Scenario: propConfig-registered prop inside alias preserves existing behavior

- **WHEN** a style object contains `_hover: { color: 'primary' }` and `color` IS registered in propConfig
- **THEN** the emitted CSS contains `&:hover { color: var(--color-primary) }` — existing behavior preserved, this requirement does not alter the propConfig-based resolution path

#### Scenario: Token-ref delimiter syntax inside alias already resolves

- **WHEN** a style object contains `_focusVisible: { outline: '2px solid {colors.primary}' }` (delimited `{scale.key}` token reference inside a shorthand string value)
- **THEN** the emitted CSS contains `&:focus-visible { outline: 2px solid var(--color-primary) }` — this is the existing behavior preserved by this requirement. The new behavior is scoped to bare scale keys on pass-through props, NOT delimited token refs which already resolve.

### Requirement: Condition alias registration via addConditions()

`createSystem()` SHALL provide an `addConditions()` method that accepts a `Record<string, string>` mapping `_`-prefixed alias names to at-rule condition strings beginning with `@media`, `@container`, or `@supports`. Registered condition aliases SHALL be recognized as block keys in style objects at every builder chain level. User-provided condition aliases SHALL merge with built-in condition aliases, and user aliases SHALL override built-ins of the same name.

#### Scenario: Register and author with a condition alias

- **WHEN** the system is configured with `.addConditions({ _motionReduce: '@media (prefers-reduced-motion: reduce)' })` and a style object contains `_motionReduce: { animation: 'none' }`
- **THEN** the emitted CSS contains `@media (prefers-reduced-motion: reduce) { .ClassName { animation: none; } }`

#### Scenario: Override a built-in condition alias

- **WHEN** a built-in condition alias `_print` exists and the system is configured with `.addConditions({ _print: '@media print and (min-resolution: 300dpi)' })`
- **THEN** `_print` blocks resolve to the user-provided query

#### Scenario: Condition kind follows the at-rule prefix

- **WHEN** `.addConditions()` registers values beginning with `@media`, `@container`, and `@supports`
- **THEN** each alias emits its block wrapped in the at-rule named by its value's prefix

### Requirement: Non-condition values rejected by addConditions()

`addConditions()` SHALL reject values that do not begin with a supported at-rule name (`@media`, `@container`, `@supports`) with a compile-time type error.

#### Scenario: Selector string rejected

- **WHEN** a system author writes `.addConditions({ _open: '&[data-state="open"]' })`
- **THEN** TypeScript produces a type error on the value

### Requirement: Cross-registry name clashes rejected by addConditions()

`addConditions()` SHALL fail loudly at system construction when an alias name is already present in the selector alias registry (built-in or user-registered). A name SHALL resolve through exactly one registry.

#### Scenario: Condition alias clashing with a built-in selector alias

- **WHEN** a system author writes `.addConditions({ _hover: '@media (hover: hover)' })` and `_hover` is a registered selector alias
- **THEN** system construction throws an error naming `_hover` and the registry it already belongs to

### Requirement: Unregistered condition keys rejected at type level

Style objects SHALL produce a compile-time type error for `_`-prefixed block keys that are neither registered condition aliases nor registered selector aliases, and for `@`-prefixed block keys that do not match the accepted at-rule key shapes. The error type SHALL name the offending key.

#### Scenario: Misspelled condition alias rejected

- **WHEN** `_motionReduce` is a registered condition alias and a style object contains `_motionReduc: { transition: 'none' }`
- **THEN** TypeScript produces a type error on the `_motionReduc` key

#### Scenario: Misspelled at-rule prefix rejected

- **WHEN** a style object contains `'@containr card (min-width: 400px)': { p: 8 }`
- **THEN** TypeScript produces a type error on that key

#### Scenario: Registered aliases accepted at depth

- **WHEN** `_cardSm` is a registered condition alias and a style object contains `_hover: { _cardSm: { p: 4 } }`
- **THEN** the style object typechecks
- **AND** scale-typed props inside the nested block retain their scale key validation

### Requirement: Merged condition map available to extraction

The system manifest SHALL include the full merged condition alias map — each entry carrying its condition string and cascade order — as a field distinct from the serialized selector map. The serialized selector map SHALL remain unchanged in shape and content for systems that register no conditions.

#### Scenario: Manifest carries registered conditions

- **WHEN** a system has custom condition aliases registered
- **THEN** the manifest includes the merged condition map for the extraction pipeline to consume
- **AND** the manifest's selector alias field is identical to what it would be without condition registrations

#### Scenario: No user registrations serializes exactly the built-in set

- **WHEN** a system registers no condition aliases
- **THEN** the manifest's condition map contains exactly the built-in condition alias set
- **AND** every other manifest field is byte-identical to the output produced before condition support existed

