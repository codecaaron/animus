## ADDED Requirements

### Requirement: Theme extension docs page
A docs page at `content/architecture/theme-extension.md` SHALL document the three theme extension patterns with code examples.

#### Scenario: Full extension via from()
- **WHEN** a reader visits the theme extension docs
- **THEN** the page explains `createTheme().from(builtTheme)` with a code example showing import of a library theme, additive `.addColors()` / `.addScale()` calls, and `.build()`
- **AND** explains that `.from()` deep merges all data (colors, scales, breakpoints, color modes, contextual vars)
- **AND** explains that same-name scales merge (union of keys, consumer values override on collision)

#### Scenario: Selective spread pattern
- **WHEN** a reader visits the theme extension docs
- **THEN** the page shows the selective spread pattern: `addColors({ ...libTokens.colors })` for cherry-picking specific scales without inheriting the full theme

#### Scenario: Distinction between from() and includes()
- **WHEN** a reader visits the theme extension docs
- **THEN** the page explicitly distinguishes `.from()` (ThemeBuilder — token/scale composition) from `.includes()` (SystemBuilder — component discovery for extraction)
- **AND** explains that a consumer app typically uses BOTH: `.from()` to extend a library's tokens and `.includes()` to enable extraction of the library's components

### Requirement: Navigation entry
The docs navigation SHALL include a link to the theme extension page under the Architecture section.

#### Scenario: Nav entry appears
- **WHEN** a user views the docs sidebar
- **THEN** "Theme Extension" appears in the Architecture section alongside "Theming", "Color Modes", and "System Setup"
