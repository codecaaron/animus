## ADDED Requirements

### Requirement: Examples page has sticky section navigator
The Examples page SHALL include a sticky navigation element that lists all demo sections and tracks the currently visible section.

#### Scenario: Navigator renders all section names
- **WHEN** Examples page loads
- **THEN** the navigator SHALL display tab/link for each demo section: Component Matrix, Usage, External Package Components, Custom Prop Transforms, Selector Aliases, Slot Composition, Portal Composition, asChild Polymorphism, The Scheme Pattern

#### Scenario: Navigator is sticky
- **WHEN** user scrolls past the navigator's initial position
- **THEN** the navigator SHALL stick to the top of the viewport (below the NavBar)

### Requirement: Active section tracking via IntersectionObserver
The navigator SHALL highlight the currently visible section as the user scrolls.

#### Scenario: Active section updates on scroll
- **WHEN** user scrolls the Examples page and "Selector Aliases" section enters the viewport
- **THEN** the "Selector Aliases" tab SHALL receive an active visual state (color change, border indicator)

#### Scenario: Only one section active at a time
- **WHEN** multiple sections are partially visible
- **THEN** the topmost section in the viewport SHALL be the active one

### Requirement: Section navigation via click
Clicking a navigator tab SHALL scroll to the corresponding section.

#### Scenario: Click scrolls to section
- **WHEN** user clicks the "Slot Composition" tab
- **THEN** the page SHALL smooth-scroll to the Slot Composition section heading

#### Scenario: URL hash updates on navigation
- **WHEN** user clicks a navigator tab
- **THEN** the URL hash SHALL update to the section's ID (e.g., `#slot-composition`) for deep linking

### Requirement: Sections have stable ID anchors
Each demo section in Examples.tsx SHALL have a stable `id` attribute on its heading for scroll targeting and deep linking.

#### Scenario: Section IDs are kebab-case
- **WHEN** Examples page renders
- **THEN** each section heading SHALL have an `id` attribute derived from its text in kebab-case (e.g., "Slot Composition" → `id="slot-composition"`)

#### Scenario: Deep link scrolls to section
- **WHEN** user navigates to `/docs/examples#selector-aliases`
- **THEN** the page SHALL scroll to the Selector Aliases section on load

### Requirement: Navigator is responsive
The navigator SHALL adapt to available width.

#### Scenario: Wide viewport shows all tabs
- **WHEN** viewport width allows all tabs to fit
- **THEN** all tabs SHALL be visible in a single horizontal row

#### Scenario: Narrow viewport scrolls tabs
- **WHEN** viewport width is too narrow for all tabs
- **THEN** the tab strip SHALL be horizontally scrollable with overflow indicators

### Requirement: Navigator tabs have accessible names
Each navigator tab SHALL be accessible to assistive technology.

#### Scenario: Tab navigation ARIA
- **WHEN** the navigator renders
- **THEN** the container SHALL have `role="tablist"` and `aria-label="Example sections"`, and each tab SHALL have `role="tab"` with `aria-selected` reflecting active state
