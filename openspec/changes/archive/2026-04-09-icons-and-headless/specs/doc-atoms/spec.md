## MODIFIED Requirements

### Requirement: CopyButton renders copy/check feedback
CopyButton SHALL display a copy icon in default state and a check icon in copied state, using lucide-react icons (`Copy`, `Check`) instead of inline SVGs. All other behavior (clipboard write, 1500ms timeout, size variants, copied state styling) remains unchanged.

#### Scenario: CopyButton default state
- **WHEN** CopyButton renders in default state
- **THEN** it displays the lucide `Copy` icon at size matching the button's size variant

#### Scenario: CopyButton copied state
- **WHEN** user clicks CopyButton and copy succeeds
- **THEN** it displays the lucide `Check` icon with `copied` state styling for 1500ms
