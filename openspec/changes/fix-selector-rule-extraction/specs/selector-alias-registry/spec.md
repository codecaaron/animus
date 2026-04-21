## ADDED Requirements

### Requirement: Theme scale resolution inside selector-alias blocks for pass-through CSS props
Inside `_`-prefixed selector-alias blocks nested within `.styles({...})` (e.g. `_hover`, `_focusVisible`, `_selected`), theme-scale-typed string values on pass-through CSS properties SHALL resolve via the theme scales to their CSS variable references. Pass-through CSS properties are CSS properties not registered in the system's propConfig but typable via `ThemedCSSProps` (e.g. `outlineColor`, `caretColor`, `accentColor`). Resolution SHALL use the scale appropriate to the CSS property family (color-family properties → `colors` scale; length properties → `space` scale; etc.).

This requirement exists because propConfig-registered props (e.g. `color`, `bg`) already resolve inside aliased blocks via the existing scale-lookup pathway. Pass-through props were previously emitted as literal unresolved scale keys (e.g. `outline-color: primary;` instead of `outline-color: var(--color-primary);`), producing invalid CSS that silently fails in browsers despite typechecking via `ThemedCSSProps`.

#### Scenario: outlineColor inside _focusVisible resolves via colors scale
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
