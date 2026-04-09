## Chain Visualizer Specification

### Requirement: Active step displays glow
The active step button SHALL render with a `box-shadow` glow using `{colors.fire.500/12}` to make the active step visually unambiguous without animation.

#### Scenario: Step activated
- **WHEN** user clicks a chain step
- **THEN** that step displays a box-shadow glow and the previously active step's glow is removed

### Requirement: Detail panel shows step content
The ChainVisualizer SHALL render a detail panel below the chain strip that displays the active step's description and code example in a split-pane layout.

#### Scenario: Step selected shows detail
- **WHEN** user clicks a chain step with description and code data
- **THEN** a panel below the strip shows description text on the left and a SyntaxBlock code example on the right

#### Scenario: Step changes update detail
- **WHEN** user clicks a different step
- **THEN** the detail panel content updates to show the newly selected step's description and code

### Requirement: Cascade specificity bar
The detail panel SHALL include a cascade specificity visualization showing relative cascade depth per step as a series of proportionally-sized bars.

#### Scenario: Bar reflects active position
- **WHEN** step 3 of 6 is active
- **THEN** bars 1-3 are accent-colored (with bar 3 brightest), bars 4-6 are ghost-colored, and bar heights increase left to right

### Requirement: Step metadata badges
Each step SHALL display a "repeatable" or "once" badge indicating whether the builder method can be called multiple times.

#### Scenario: Repeatable step
- **WHEN** a step has `repeatable: true`
- **THEN** an amber "repeatable" badge is displayed

#### Scenario: Once-only step
- **WHEN** a step has `repeatable: false`
- **THEN** a neutral "once" badge is displayed
