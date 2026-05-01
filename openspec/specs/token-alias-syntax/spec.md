## ADDED Requirements

### Requirement: Token alias syntax in string style values

The extraction pipeline SHALL recognize `{scale.path}` patterns inside string literal style values and resolve them at compile time against the theme. A string containing one or more `{...}` patterns SHALL be classified as static (not skipped or bailed) by the style evaluator, and each alias SHALL be resolved to either a CSS variable reference or a literal value during theme resolution.

#### Scenario: Single token alias in a string

- **WHEN** a style value is `'1px solid {colors.primary}'` and theme has variable `--colors-primary` for token `colors.primary`
- **THEN** the resolved CSS value SHALL be `1px solid var(--colors-primary)`

#### Scenario: Token alias as entire value

- **WHEN** a style value is `'{colors.primary}'`
- **THEN** the resolved CSS value SHALL be `var(--colors-primary)` — alias works as standalone value, not only embedded in compounds

#### Scenario: Multiple aliases in one value

- **WHEN** a style value is `'{space.4} {space.8}'` and theme has literal values `space.4 → "0.25rem"`, `space.8 → "0.5rem"`
- **THEN** the resolved CSS value SHALL be `0.25rem 0.5rem`

#### Scenario: Alias in box-shadow compound

- **WHEN** a style value is `'0 4px 12px {colors.primary/20}'`
- **THEN** the resolved CSS value SHALL resolve the alias (with alpha) and produce the compound value with the resolved token embedded

#### Scenario: No aliases in plain string

- **WHEN** a style value is `'1px solid red'` (no `{...}` pattern)
- **THEN** the value SHALL pass through unchanged — no scanning overhead for strings without braces

#### Scenario: String with alias is still classified as static

- **WHEN** the style evaluator encounters `border: '1px solid {colors.primary}'`
- **THEN** it SHALL classify the value as a static string literal — the `{` is a character in the string, not a JS expression delimiter

### Requirement: Dot-path resolution with hyphen conversion

Token alias paths SHALL use dot notation matching the lodash `_.get()` convention used at runtime. The resolver SHALL convert dot paths to flat theme keys by treating the first segment as the scale name and joining remaining segments with hyphens.

#### Scenario: Simple one-level path

- **WHEN** alias is `{colors.primary}`
- **THEN** the flat key lookup SHALL be `"colors.primary"`

#### Scenario: Nested path with dot-to-hyphen conversion

- **WHEN** alias is `{colors.pink.600}`
- **THEN** the flat key lookup SHALL be `"colors.pink-600"` — `pink` and `600` joined with hyphen

#### Scenario: Deeply nested path

- **WHEN** alias is `{colors.gradient.pink.soft}`
- **THEN** the flat key lookup SHALL be `"colors.gradient-pink-soft"`

#### Scenario: Default value (elided underscore)

- **WHEN** alias is `{colors.text}` and the theme has semantic token `text: { _: 'navy-700', shadow: 'navy-900' }`
- **THEN** the flat key lookup SHALL be `"colors.text"` — the `_` default is already elided in the flat key

#### Scenario: Non-color scale

- **WHEN** alias is `{space.8}`
- **THEN** the flat key lookup SHALL be `"space.8"` — single-level paths have no hyphen conversion

### Requirement: Alpha modifier on token aliases

Token aliases SHALL support an optional `/N` suffix where N is an integer 0-100 representing an opacity percentage. The resolver SHALL produce a CSS `color-mix()` expression wrapping the resolved token.

#### Scenario: 50% opacity on variable-backed token

- **WHEN** alias is `{colors.primary/50}` and token `colors.primary` has variable `--colors-primary`
- **THEN** the resolved value SHALL be `color-mix(in srgb, var(--colors-primary) 50%, transparent)`

#### Scenario: Full opacity (100)

- **WHEN** alias is `{colors.primary/100}`
- **THEN** the resolved value SHALL be `var(--colors-primary)` — 100% opacity is identity, no color-mix wrapper needed

#### Scenario: Zero opacity

- **WHEN** alias is `{colors.primary/0}`
- **THEN** the resolved value SHALL be `transparent` — 0% of any color is transparent

#### Scenario: Alpha on non-variable token

- **WHEN** alias is `{colors.pink.500/30}` and `colors.pink-500` resolves to literal `"#ff80bf"` (no CSS variable)
- **THEN** the resolved value SHALL be `color-mix(in srgb, #ff80bf 30%, transparent)` — color-mix works with literals too

#### Scenario: Alpha in compound value

- **WHEN** a style value is `'0 4px 12px {colors.primary/20}'`
- **THEN** the `{colors.primary/20}` portion SHALL be replaced with the color-mix expression, embedded in the compound value

### Requirement: Variable-aware theme resolution

The Rust extraction pipeline SHALL accept a variable-name map alongside the existing flat value map. For each token alias, the resolver SHALL check the variable map first: if present, resolve to `var(--name)`; if absent, resolve to the literal value from the flat map.

#### Scenario: Token with CSS variable

- **WHEN** alias is `{colors.primary}` and variable map has `"colors.primary" → "--colors-primary"`
- **THEN** the resolved value SHALL be `var(--colors-primary)`

#### Scenario: Token without CSS variable

- **WHEN** alias is `{space.8}` and variable map has no entry for `"space.8"`, but flat map has `"space.8" → "0.5rem"`
- **THEN** the resolved value SHALL be `0.5rem`

#### Scenario: Token not found in either map

- **WHEN** alias is `{colors.nonexistent}` and neither map has a matching entry
- **THEN** the resolver SHALL emit a warning diagnostic (format: `[alias] ComponentName: unresolved token '{colors.nonexistent}'`) and leave the alias text in place as-is

#### Scenario: Variable map passed to Rust

- **WHEN** the Vite plugin serializes the theme at build start
- **THEN** it SHALL pass a JSON variable-name map `{ "token.path": "--css-var-name" }` to the Rust pipeline alongside the existing flat value map

### Requirement: Token alias diagnostics

Unresolved token aliases SHALL produce warning diagnostics in the extraction output, following the same pattern as per-property skip warnings.

#### Scenario: Unresolved alias warning format

- **WHEN** alias `{colors.typo}` in component `Hero` cannot be resolved
- **THEN** `ExtractionResult.errors` SHALL contain `"[alias] Hero: unresolved token '{colors.typo}'"`

#### Scenario: Resolved aliases produce no warnings

- **WHEN** all aliases in a component resolve successfully
- **THEN** no alias-related entries SHALL appear in `ExtractionResult.errors`

#### Scenario: Multiple unresolved aliases produce multiple warnings

- **WHEN** a component has `'1px {borders.typo} {colors.typo}'`
- **THEN** `ExtractionResult.errors` SHALL contain one warning per unresolved alias

### Requirement: Token alias opacity modifier

The system SHALL resolve `{scale.path/opacity}` syntax to `color-mix(in srgb, {resolved} {opacity}%, transparent)` in all resolution contexts: Rust crate extraction, pipeline `resolveTokenAliases`, AND theme-level `resolveTokenRefs`.

#### Scenario: Opacity modifier in theme scale cross-reference

- **WHEN** a theme scale value contains `{colors.primary/40}` and `colors.primary` resolves to a raw value (non-emitted scale)
- **THEN** `resolveTokenRefs` SHALL produce `color-mix(in srgb, #6366f1 40%, transparent)` (not the raw color without opacity)

#### Scenario: Opacity modifier with var() reference in theme scale

- **WHEN** a theme scale value contains `{colors.primary/40}` and `colors.primary` resolves to `var(--color-primary)` (emitted scale)
- **THEN** `resolveTokenRefs` SHALL produce `color-mix(in srgb, var(--color-primary) 40%, transparent)`

#### Scenario: Zero opacity

- **WHEN** a theme scale value contains `{colors.primary/0}`
- **THEN** `resolveTokenRefs` SHALL produce `transparent`

### Requirement: Theme-level token ref resolution in scale values

Scale values passed to `addScale()` SHALL support `{scale.key}` token ref syntax. The ThemeBuilder SHALL resolve these refs at `build()` time, after all scales have been collected, so declaration order does not affect resolution. Only scales marked `emit: true` may be referenced (enforced at both the type level and at runtime). Self-referential token refs (a scale referencing itself) SHALL produce a runtime warning and leave the ref unresolved.

#### Scenario: Direct token ref in scale value

- **WHEN** consumer calls `.addScale({ name: 'semantic', values: { primary: '{colors.blue-500}' }, emit: true })` and `colors.blue-500` is an emitted token
- **THEN** `build()` SHALL resolve `{colors.blue-500}` to `var(--colors-blue-500)` in the output scale

#### Scenario: Multiple token refs in one scale value

- **WHEN** a scale value is `'{space.sm} {space.md}'` and both `space.sm` and `space.md` are emitted tokens
- **THEN** `build()` SHALL replace each ref independently, producing e.g. `var(--space-sm) var(--space-md)`

#### Scenario: Ref to non-emitted scale (type error)

- **WHEN** consumer writes `'{sizes.lg}'` in a scale value and `sizes` was added without `emit: true`
- **THEN** TypeScript SHALL produce a type error — only `ScaleTokenRef<EmittedScales>` paths are valid ref targets. At runtime, `build()` SHALL also warn and leave the ref unresolved.

#### Scenario: Forward reference resolved correctly

- **WHEN** scale A references `{scaleB.key}` and scale B is declared after scale A in the builder chain
- **THEN** `build()` SHALL still resolve the ref correctly — resolution happens after all scales are collected, not at declaration time

#### Scenario: Self-referential token ref produces warning

- **WHEN** scale `space` contains a value `'{space.sm}'` (referencing its own scale)
- **THEN** `build()` SHALL emit a console warning (format: `[theme] self-referential token ref '{space.sm}' in scale 'space'`) and leave the ref unresolved rather than recursing infinitely
