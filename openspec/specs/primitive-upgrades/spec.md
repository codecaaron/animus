# primitive-upgrades Specification

## Purpose
TBD - created by archiving change doc-v4-patterns. Update Purpose after archive.
## Requirements
### Requirement: Callout deprecated variant
The Callout component SHALL support a `deprecated` variant with visually distinct styling to indicate deprecated APIs or patterns.

#### Scenario: Deprecated callout renders with dashed border
- **WHEN** a Callout renders with `variant="deprecated"`
- **THEN** the left border uses a dashed style (not solid) with violet/purple color tokens

#### Scenario: Deprecated icon and title use violet color
- **WHEN** a deprecated Callout renders with a title
- **THEN** the icon and title text use the violet color scale, matching the border

### Requirement: ParamTable required dot
The ParamTable SHALL use a small visual dot indicator for required parameters instead of text.

#### Scenario: Required param shows accent dot
- **WHEN** a parameter has default value "required"
- **THEN** a 5px accent-colored circle renders after the parameter name instead of the text "required"

#### Scenario: Optional params show default value unchanged
- **WHEN** a parameter has a non-"required" default value
- **THEN** the default value renders as dim mono text (existing behavior, unchanged)

### Requirement: SyntaxBlock file-type dot
The SyntaxBlock title bar SHALL display a colored dot indicating the file type when a title is provided.

#### Scenario: TypeScript file shows blue dot
- **WHEN** SyntaxBlock renders with a title and language "tsx" or "typescript"
- **THEN** an 8px blue dot appears before the title text

#### Scenario: CSS file shows green dot
- **WHEN** SyntaxBlock renders with a title and language "css"
- **THEN** an 8px green dot appears before the title text

#### Scenario: No dot without title
- **WHEN** SyntaxBlock renders without a title (no chrome)
- **THEN** no file-type dot is rendered

### Requirement: APIBlock unified container
The system SHALL provide an APIBlock component that wraps TypeSignature and ParamTable into a single bordered unit.

#### Scenario: Signature renders as header, table as body
- **WHEN** APIBlock receives signature props and params
- **THEN** TypeSignature renders as the top section and ParamTable renders below it, sharing a single outer border

#### Scenario: Individual borders suppressed
- **WHEN** TypeSignature and ParamTable render inside APIBlock
- **THEN** their individual borders are suppressed by the container's CSS, preventing double borders

