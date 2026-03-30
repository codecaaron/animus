## ADDED Requirements

### Requirement: Showcase build output contains valid extraction CSS
After the showcase Vite build completes, the output CSS SHALL contain evidence of successful extraction: `@layer` declarations, resolved CSS variables, and component class names.

#### Scenario: CSS file exists and is non-empty
- **WHEN** `bun run test:showcase` completes
- **THEN** at least one `.css` file SHALL exist in `packages/showcase/dist/assets/`
- **AND** the file SHALL be non-empty

#### Scenario: CSS contains layer declarations
- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL contain `@layer global, base, variants, compounds, states, system, custom`

#### Scenario: No unresolved transform placeholders
- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL NOT contain `__TRANSFORM__` strings

#### Scenario: Variable CSS present
- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL contain `:root {` indicating CSS variable declarations were emitted

#### Scenario: Component class names present
- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL contain `animus-` prefixed class names

### Requirement: Showcase JS bundle has no runtime CSS dependencies
The showcase JS output SHALL NOT import Emotion or other runtime CSS-in-JS libraries.

#### Scenario: No Emotion imports in JS bundle
- **WHEN** the showcase JS output files are inspected
- **THEN** no file SHALL contain `@emotion` import references
