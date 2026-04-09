## MODIFIED Requirements

### Requirement: Heading uses CSS-only anchor hover
Heading SHALL use `_hover` selector alias on HeadingWrapper to reveal the anchor button via CSS, replacing JavaScript onMouseEnter/onMouseLeave event handlers.

#### Scenario: Anchor visibility on hover
- **WHEN** user hovers over a heading
- **THEN** the anchor button opacity SHALL transition to visible via CSS `_hover: { '& [data-anchor]': { opacity: '0.5' } }` on the wrapper
- **AND** no JavaScript event handlers SHALL be used for this behavior

### Requirement: Heading anchor uses states for copied feedback
AnchorButton SHALL use `.states({ copied })` for the copied visual feedback instead of inline style.

#### Scenario: Copy feedback via states
- **WHEN** user clicks the anchor button and the URL is copied
- **THEN** the AnchorButton SHALL receive the `copied` state prop
- **AND** the visual change (color, opacity) SHALL be applied via `@layer states` CSS

### Requirement: Heading anchor is a button element
AnchorButton SHALL be a `<button>` element instead of `<span role="button" tabIndex={0}>`.

#### Scenario: Semantic button element
- **WHEN** AnchorButton renders
- **THEN** it SHALL be an HTML `<button>` element with native keyboard handling (Enter/Space to activate)
- **AND** it SHALL include `_focusVisible` styles for keyboard focus indication

### Requirement: SyntaxBlock CollapseToggle uses states
CollapseToggle SHALL use `.states({ collapsed: { transform: 'rotate(-90deg)' } })` instead of inline style for rotation.

#### Scenario: Collapse rotation via states
- **WHEN** the SyntaxBlock is collapsed
- **THEN** the CollapseToggle SHALL receive the `collapsed` state prop
- **AND** the rotation SHALL be applied via `@layer states` CSS

### Requirement: SyntaxBlock theme token consistency
The `animusTheme.plain.color` SHALL use `tokens.varRef('colors.text')` instead of `tokens.colors.text` for consistent CSS variable resolution.

#### Scenario: Theme uses varRef consistently
- **WHEN** the syntax theme is applied
- **THEN** all color references in the theme object SHALL use `tokens.varRef()` for CSS variable resolution
