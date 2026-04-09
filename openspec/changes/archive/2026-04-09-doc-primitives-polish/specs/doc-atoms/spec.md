## MODIFIED Requirements

### Requirement: CopyButton focus visibility
CopyButton SHALL display a visible focus indicator when navigated to via keyboard.

#### Scenario: Keyboard focus on CopyButton
- **WHEN** user tabs to a CopyButton element
- **THEN** a focus ring outline SHALL appear via the `_focusVisible` selector alias
