## Purpose

Requirements for the `doc-atoms` capability: CopyButton renders copy/check feedback; TokenBadge component; Animus extraction compatibility; and 2 more.

## Requirements

### Requirement: CopyButton renders copy/check feedback

CopyButton SHALL display a copy icon in default state and a check icon in copied state, using lucide-react icons (`Copy`, `Check`) instead of inline SVGs. All other behavior (clipboard write, 1500ms timeout, size variants, copied state styling) remains unchanged.

#### Scenario: CopyButton default state

- **WHEN** CopyButton renders in default state
- **THEN** it displays the lucide `Copy` icon at size matching the button's size variant

#### Scenario: CopyButton copied state

- **WHEN** user clicks CopyButton and copy succeeds
- **THEN** it displays the lucide `Check` icon with `copied` state styling for 1500ms

### Requirement: TokenBadge component

A semantic colored inline badge with 7 variants. The component SHALL accept a `variant` prop with values: `'method' | 'layer' | 'type' | 'prop' | 'tag' | 'danger' | 'success'`. Each variant SHALL define a distinct `{background, borderColor, color}` triplet using the token opacity syntax (`'{colors.palette.weight/opacity}'`). Background colors SHALL use raw palette paths with 12% or 8% opacity for tinted backgrounds. Border and text colors SHALL use raw palette paths for stable identity across color modes. No hardcoded hex or rgba values.

#### Scenario: Variant styling via token opacity

- **WHEN** TokenBadge renders with variant="method"
- **THEN** it displays with bg `'{colors.primary/12}'`, border from `'{colors.fire.700}'`, and color `'primary'`

#### Scenario: All 7 variants render distinctly using raw palette for identity stability

- **WHEN** each of the 7 variants renders side by side
- **THEN** each has a visually distinct color scheme via raw palette paths: method=fire(red), layer=forest(green), type=violet(purple), prop=gold(amber), tag=ocean(blue), danger=fire(muted red), success=forest(muted green)

#### Scenario: Color mode independence

- **WHEN** the color mode changes (e.g., dark → ocean → violet)
- **THEN** TokenBadge variant colors remain stable (raw palette refs don't shift with mode)

#### Scenario: Inline usage

- **WHEN** TokenBadge is placed inline within prose text
- **THEN** it renders as an inline-flex element with monospace font, appropriate padding, and does not break text flow

### Requirement: Animus extraction compatibility

All doc-atom components SHALL be built with `ds.styles()`, `.variant()`, and `.states()` from the showcase design system instance. They SHALL extract to static CSS via the standard extraction pipeline.

#### Scenario: CopyButton extracts

- **WHEN** the showcase builds
- **THEN** CopyButton's styled elements produce extracted CSS classes with `animus-` prefix

#### Scenario: TokenBadge variants extract

- **WHEN** the showcase builds
- **THEN** each TokenBadge variant produces distinct CSS rules in `@layer variants`

### Requirement: Barrel export

All new doc-atom components SHALL be exported from `components/index.ts`.

#### Scenario: Named exports available

- **WHEN** a consumer imports `{ CopyButton, TokenBadge }` from the components barrel
- **THEN** both components are available

### Requirement: CopyButton focus visibility

CopyButton SHALL display a visible focus indicator when navigated to via keyboard.

#### Scenario: Keyboard focus on CopyButton

- **WHEN** user tabs to a CopyButton element
- **THEN** a focus ring outline SHALL appear via the `_focusVisible` selector alias
