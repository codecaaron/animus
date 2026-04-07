## ADDED Requirements

### Requirement: ColorPalette displays all available color modes as swatches
The ColorPalette SHALL render a grid of swatches, one per color mode. Each swatch SHALL preview that mode's primary, background, and surface colors.

#### Scenario: All 10 modes visible
- **WHEN** ColorPalette renders
- **THEN** 10 swatches SHALL be visible, one for each mode: dark, light, midnight, ember, ocean, forest, violet, rose, terra, adobe

#### Scenario: Swatch previews mode colors
- **WHEN** a swatch for mode "ember" renders
- **THEN** the swatch SHALL display the ember mode's background, primary, and surface token colors as visual previews

### Requirement: ColorPalette indicates active mode
The currently active color mode SHALL be visually distinguished from inactive modes.

#### Scenario: Active mode has visual indicator
- **WHEN** the current color mode is "dark"
- **THEN** the "dark" swatch SHALL have a distinct visual indicator (border, ring, or checkmark) that inactive swatches do not have

#### Scenario: Active indicator updates on mode change
- **WHEN** user selects a different mode
- **THEN** the active indicator SHALL move to the newly selected swatch and be removed from the previously active swatch

### Requirement: ColorPalette supports direct mode selection
Users SHALL be able to select any color mode directly without cycling through intermediate modes.

#### Scenario: Click selects mode
- **WHEN** user clicks on the "ocean" swatch
- **THEN** the color mode SHALL change to "ocean" immediately, applying `data-color-mode="ocean"` to the document element and persisting to localStorage

#### Scenario: Keyboard selection
- **WHEN** user focuses a swatch and presses Enter or Space
- **THEN** the color mode SHALL change to that swatch's mode

### Requirement: ColorPalette is keyboard navigable
The ColorPalette SHALL implement radiogroup keyboard navigation patterns.

#### Scenario: Arrow key navigation
- **WHEN** focus is on a swatch and user presses ArrowRight or ArrowDown
- **THEN** focus SHALL move to the next swatch in the grid

#### Scenario: Arrow key wrapping
- **WHEN** focus is on the last swatch and user presses ArrowRight
- **THEN** focus SHALL wrap to the first swatch

#### Scenario: Radiogroup ARIA roles
- **WHEN** ColorPalette renders
- **THEN** the container SHALL have `role="radiogroup"` and `aria-label="Color mode"`, and each swatch SHALL have `role="radio"` with `aria-checked` reflecting active state

### Requirement: ColorPalette is accessible from navigation
The ColorPalette SHALL be accessible from the NavBar via a trigger in the Actions slot.

#### Scenario: Palette trigger opens palette panel
- **WHEN** user activates the color mode trigger in the NavBar
- **THEN** a panel containing the ColorPalette SHALL appear (Drawer on mobile, popover/dropdown on desktop)

#### Scenario: Mode label visible in nav
- **WHEN** the NavBar renders
- **THEN** the current color mode name SHALL be visible as text in the Actions slot

### Requirement: ColorPalette swatches have hover preview
Swatches SHALL provide visual feedback on hover.

#### Scenario: Hover highlights swatch
- **WHEN** user hovers over an inactive swatch
- **THEN** the swatch SHALL show a hover state (elevation change, border highlight, or subtle scale) using `_hover` selector alias

#### Scenario: Focus visible on swatch
- **WHEN** user focuses a swatch via keyboard
- **THEN** a focus ring SHALL appear using `_focusVisible` selector alias
