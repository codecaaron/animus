## ADDED Requirements

### Requirement: Three-column docs layout

The docs layout SHALL use a three-column structure: left sidebar, center content, right ToC.

#### Scenario: Full-width viewport

- **WHEN** the viewport is 1280px or wider
- **THEN** all three columns are visible with the content column at least 700px wide

### Requirement: Right column collapses first

The right-column ToC SHALL be the first element to collapse as viewport narrows.

#### Scenario: Viewport at 1024px

- **WHEN** the viewport is at or below 1024px
- **THEN** the right-column ToC is hidden and the content area expands to fill the freed space

#### Scenario: Viewport above 1024px

- **WHEN** the viewport is above 1024px
- **THEN** the right-column ToC is visible

### Requirement: Left sidebar persists longer

The left sidebar SHALL remain visible at viewports where the right column has already collapsed.

#### Scenario: Medium viewport with sidebar visible

- **WHEN** the viewport is between the sidebar breakpoint and 1024px
- **THEN** the left sidebar is visible and the right ToC is hidden, producing a two-column layout

### Requirement: Content column minimum width

The content column SHALL maintain sufficient width for code blocks when all columns are visible.

#### Scenario: Three columns at 1280px

- **WHEN** the viewport is 1280px with all three columns visible
- **THEN** the content column is at least 700px wide

### Requirement: Layout graceful degradation

The layout SHALL degrade cleanly through breakpoints: three columns → two columns → single column.

#### Scenario: Progressive collapse

- **WHEN** the viewport narrows progressively from 1440px to 768px
- **THEN** the right ToC hides first, then the left sidebar hides, and the content area fills the viewport at each stage
