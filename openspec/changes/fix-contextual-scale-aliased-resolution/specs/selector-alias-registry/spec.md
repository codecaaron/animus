## ADDED Requirements

### Requirement: Nested scale paths into mode-overridable sub-scales resolve inside aliased and raw-selector blocks
Inside `_`-prefixed selector-alias blocks (e.g. `_focusVisible`, `_hover`) AND raw `&:pseudo` blocks nested within `.styles({...})`, nested scale-path references (e.g. `{colors.scheme.300}`) that dereference into mode-overridable sub-scales SHALL emit the same resolved token alias that the identical value string would produce at the top level of `.styles({...})`. The containing rule SHALL NOT be elided.

A "mode-overridable sub-scale" is a sub-scale registered via `addModes(...)` on the theme builder such that the emitted value switches under `[data-color-mode]` selectors. Mode-overridable sub-scales are distinct from contextual-vars (per the `contextual-vars` spec), which are property-bound runtime bindings like `currentBg`.

#### Scenario: Nested mode-overridable path inside `_focusVisible` emits the rule with resolved value
- **WHEN** a `.styles({...})` call contains `_focusVisible: { outline: '2px solid {colors.scheme.300}' }` and the theme registers `colors.scheme` via `addModes(...)` so that `scheme.300` has per-color-mode values
- **THEN** the dist CSS SHALL contain a `:focus-visible` rule for the component with `outline: 2px solid <resolved token for colors.scheme-300>` where the resolved token is the same string emitted if the same value had been written at the top level of `.styles({...})`

#### Scenario: Nested mode-overridable path inside raw `&:pseudo` emits the rule
- **WHEN** a `.styles({...})` call contains `'&:focus-visible': { outline: '2px solid {colors.scheme.300}' }`
- **THEN** the dist CSS SHALL contain the corresponding pseudo-rule with `outline` resolved to the same token the `_focusVisible` alias form would emit (raw and aliased SHALL be observably equivalent for this value shape)

#### Scenario: Simple mode-overridable ref inside aliased block emits the rule
- **WHEN** a `.styles({...})` call contains `_focusVisible: { color: '{colors.scheme.300}' }` (simple ref, not embedded in a compound)
- **THEN** the dist CSS SHALL contain the `:focus-visible` rule with `color: <resolved token>` — confirms the drop is not a simple-vs-compound question

#### Scenario: Nested flat-palette path inside aliased block continues to work (regression guard)
- **WHEN** a `.styles({...})` call contains `_focusVisible: { outline: '2px solid {colors.fire.500}' }` and `fire` is a flat palette sub-scale (not registered via `addModes`)
- **THEN** the dist CSS SHALL contain the `:focus-visible` rule with `outline` resolved — this scenario protects against a regression that would restrict the fix too narrowly to mode-overridable paths only

#### Scenario: Top-level mode-overridable path continues to work (regression guard)
- **WHEN** `outline: '2px solid {colors.scheme.300}'` is written at the top level of `.styles({...})` (not inside any aliased or raw-selector block)
- **THEN** the dist CSS SHALL contain the base rule with `outline` resolved to the same token as before this change — top-level resolution SHALL NOT regress

#### Scenario: Aliased block containing an unresolvable token does not spuriously drop
- **WHEN** a `.styles({...})` call contains `_focusVisible: { outline: '2px solid {colors.nonexistent}' }`
- **THEN** the dist CSS SHALL still contain the `:focus-visible` rule with the unresolved token emitted as literal text, consistent with the `unresolvable-token` characterization established in the prior arc's Pattern F — unresolvable tokens do not drop the containing rule
