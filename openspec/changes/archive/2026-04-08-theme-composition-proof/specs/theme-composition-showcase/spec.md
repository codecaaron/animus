## ADDED Requirements

### Requirement: Theme Composition section on Examples page
The Examples page SHALL include a "Theme Composition" section demonstrating `.from()` theme extension with `referenceTokens` from `@animus-ui/test-ds`.

#### Scenario: Section renders with explanatory prose and code example
- **WHEN** a user navigates to the Examples page
- **THEN** a "Theme Composition" section appears showing a code example of `createTheme().from(referenceTokens).addColors({...}).build()`
- **AND** prose explains that `.from()` deep merges the library theme (colors, scales, breakpoints, color modes)

#### Scenario: Section shows test-ds components rendering against consumer theme
- **WHEN** the "Theme Composition" section renders
- **THEN** test-ds `Button` and `Card` components are rendered inline, styled by the showcase's consumer theme
- **AND** the section explains these components were authored against test-ds's reference theme but render correctly because the consumer theme includes compatible tokens

### Requirement: Section appears after External Package Components
The "Theme Composition" section SHALL appear immediately after the existing "External Package Components" section to create a narrative flow: external components → theme extension.

#### Scenario: Section ordering
- **WHEN** a user scrolls through the Examples page
- **THEN** "External Package Components" appears before "Theme Composition"
