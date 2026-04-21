## ADDED Requirements

### Requirement: `{scale.path}` resolution is position-independent and scale-shape-independent
The `{scale.path}` token-alias syntax's resolution contract SHALL produce the same CSS output string regardless of (a) the authoring position of the enclosing style (top-level `.styles({...})`, `_`-prefixed selector-alias block, or raw `&:pseudo` block) AND (b) whether the path terminates in a flat palette entry or a mode-overridable sub-scale entry (registered via `addModes(...)`).

"Same CSS output string" means: the identical value expression (e.g. `'2px solid {colors.scheme.300}'`) resolves to the identical rendered CSS fragment (e.g. `'2px solid var(--colors-scheme-300)'`, where the var name is derived from the flat theme key via the existing dot-to-hyphen convention). The enclosing selector is unaffected; only the *value* resolution is constrained.

This requirement codifies an invariant that was previously implicit and silently violated for the aliased × mode-overridable intersection — see the `selector-alias-registry` delta for the concrete failure case (Heading.tsx:63 regression).

#### Scenario: Same value string resolves identically at top level and inside aliased block
- **WHEN** a `.styles({...})` call has the SAME value expression (e.g. `'2px solid {colors.scheme.300}'`) appearing at both (a) the top level as `outline: '2px solid {colors.scheme.300}'` and (b) inside `_focusVisible: { outline: '2px solid {colors.scheme.300}' }`
- **THEN** the extracted CSS SHALL contain the same resolved fragment for `outline` in both positions (modulo the selector prefix — base class for (a), `:focus-visible` for (b))

#### Scenario: Same value string resolves identically for flat-palette and mode-overridable paths (structurally)
- **WHEN** two distinct value expressions differ ONLY in whether the path lands in a flat-palette scale (e.g. `{colors.fire.500}`) or a mode-overridable sub-scale (e.g. `{colors.scheme.300}`), and both flat keys exist in the flat theme map
- **THEN** the resolution pipeline SHALL produce a resolved CSS fragment of the same SHAPE — either both emit as `var(--<flat-key-as-css-var>)` or both emit as the literal resolved value per the theme's emission strategy for that scale; the extractor SHALL NOT emit one shape and silently drop the other

#### Scenario: Raw `&:pseudo` and `_aliased` forms resolve identically for the same value
- **WHEN** the same value expression (e.g. `'2px solid {colors.scheme.300}'`) appears inside `_focusVisible: {...}` and inside `'&:focus-visible': {...}` on structurally-equivalent `.styles({...})` calls
- **THEN** both forms SHALL emit the same resolved CSS value for the property, producing observably equivalent dist CSS rules (aside from any trivial ordering of selectors in the stylesheet)
