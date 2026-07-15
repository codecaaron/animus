## Purpose

Requirements for the `color-mode-palette` capability: ColorPalette displays all available color modes as swatches; ColorPalette indicates active mode; ColorPalette supports direct mode selection; and 3 more.

## Requirements

### Requirement: ColorPalette displays all available color modes as swatches

The ColorPalette SHALL render a 2-column grid of swatches, one per color mode. Dark modes in the left column, light modes in the right. Each swatch SHALL preview that mode's background and primary colors as a miniature landscape (bg band, primary line, text sample).

#### Scenario: All 10 modes visible in dark/light columns

- **WHEN** ColorPalette renders
- **THEN** 10 swatches SHALL be visible in order: dark|light, midnight|ocean, ember|forest, violet|rose, terra|adobe

### Requirement: ColorPalette indicates active mode

The currently active color mode SHALL be visually distinguished via a 2px border in that mode's own primary color on the swatch card itself.

#### Scenario: Active mode has self-referential border

- **WHEN** the current color mode is "ocean"
- **THEN** the "ocean" swatch card SHALL have a `2px solid` border using ocean's primary hex color (`#003d99`). All inactive swatches SHALL have a `1px solid` border using the `border` token.

#### Scenario: Active indicator updates on mode change

- **WHEN** user selects a different mode
- **THEN** the active border SHALL move to the newly selected swatch

### Requirement: ColorPalette supports direct mode selection

Users SHALL be able to select any color mode directly without cycling through intermediate modes.

#### Scenario: Click selects mode

- **WHEN** user clicks on a swatch
- **THEN** the color mode SHALL change immediately, applying `data-color-mode` to the document element and persisting to localStorage

### Requirement: ColorPalette is keyboard navigable

The ColorPalette SHALL implement radiogroup keyboard navigation patterns.

#### Scenario: Arrow key navigation

- **WHEN** focus is on a swatch and user presses ArrowRight or ArrowDown
- **THEN** focus SHALL move to the next swatch in the grid

#### Scenario: Radiogroup ARIA roles

- **WHEN** ColorPalette renders
- **THEN** the container SHALL have `role="radiogroup"` and `aria-label="Color mode"`, and each swatch SHALL have `role="radio"` with `aria-checked` reflecting active state

### Requirement: ColorPalette is accessible from navigation

The ColorPalette SHALL be accessible via a trigger in NavBar.Actions that opens a right-positioned Drawer. The current mode name SHALL be visible as text in the trigger.

#### Scenario: Navigation trigger exposes the current mode

- **WHEN** the navigation actions render
- **THEN** a trigger SHALL display the current mode name
- **AND** activating it SHALL open the ColorPalette in a right-positioned Drawer

### Requirement: ColorPalette swatches have hover preview

Swatches SHALL scale up on hover (`transform: scale(1.06)`) with a spring curve transition. Focus-visible SHALL show a 2px primary outline.

#### Scenario: Pointer and keyboard previews remain distinguishable

- **WHEN** a pointer hovers a swatch
- **THEN** the swatch SHALL scale to `1.06` using the spring transition
- **AND** when the swatch receives focus-visible, it SHALL show a 2px primary outline
