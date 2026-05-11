## ADDED Requirements

### Requirement: Extended component in showcase
At least one showcase component SHALL use `.extend()` to create a variant of an existing base component, demonstrating provenance-tracked extension.

#### Scenario: ButtonLink extends Button
- **WHEN** the showcase builds
- **THEN** a `ButtonLink` component exists, created via `Button.extend().asElement('a')`
- **AND** the component accepts `href` and other anchor element props
- **AND** the component inherits Button's variants (variant, size)
- **AND** extraction produces CSS with both parent and child in the same `@layer`, source-ordered

### Requirement: Extension Chains section on Examples page
The Examples page SHALL include an "Extension Chains" section rendering base and extended components side-by-side.

#### Scenario: Side-by-side rendering
- **WHEN** a user navigates to the Examples page
- **THEN** an "Extension Chains" section shows `Button` and `ButtonLink` (or equivalent) rendering with the same variant props
- **AND** prose explains that `.extend()` creates a new component that inherits the parent's cascade position

#### Scenario: Section demonstrates variant inheritance
- **WHEN** the "Extension Chains" section renders
- **THEN** both base and extended components are shown with at least two variant values to demonstrate inheritance
