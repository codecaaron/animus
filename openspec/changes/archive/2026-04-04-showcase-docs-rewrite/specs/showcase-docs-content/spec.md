## ADDED Requirements

### Requirement: Guided pages follow story-driven structure
Each guided docs page SHALL answer one or more user stories from the story inventory. Pages SHALL NOT be organized around API names or framework internals.

#### Scenario: Getting Started page covers stories 1-3
- **WHEN** a user reads the Getting Started page
- **THEN** it SHALL show: install commands, Vite config, a styled component with nested selectors, and rendered output — in that order, with the component visible before setup is fully explained

#### Scenario: Variants & States page covers stories 4-6
- **WHEN** a user reads the Variants & States page
- **THEN** it SHALL show: a variant with named options (size/intent pattern), a compound combining two variants, and a boolean state prop — each with working code and output CSS showing the `@layer` each emits to

#### Scenario: System Props page covers stories 7-8
- **WHEN** a user reads the System Props page
- **THEN** it SHALL show: opting into pre-built groups via `.system()`, using the exposed props in JSX, and responsive breakpoint objects with `_` as base

### Requirement: Code-first page format
Every guided page SHALL lead with a copy-pasteable code example before any prose explanation. The ratio SHALL be approximately 80% code blocks to 20% prose.

#### Scenario: Page opens with working code
- **WHEN** a user opens any guided docs page
- **THEN** the first content element after the title SHALL be a code block, not a paragraph of explanation

#### Scenario: Prose is minimal
- **WHEN** a concept is introduced on a guided page
- **THEN** it SHALL have at most 2 sentences of prose between code blocks

### Requirement: Cascade-first mental model
Docs SHALL teach that every builder method accepts CSS objects with full nested selector support. The ONLY difference between methods is the cascade layer and how styles are keyed.

#### Scenario: States documented as cascade priority, not CSS pseudo-classes
- **WHEN** `.states()` is explained
- **THEN** it SHALL be described as "boolean props whose styles emit at `@layer states`" — NOT as "hover/disabled handlers" or "interaction states"
- **AND** the example SHALL show that state CSS objects support nested selectors, data attributes, and pseudo-classes just like `.styles()`

#### Scenario: Nested selectors shown in .styles()
- **WHEN** hover or focus behavior is first introduced
- **THEN** it SHALL be shown as a nested selector in `.styles()` (e.g., `'&:hover': { ... }`), NOT in `.states()`

#### Scenario: Output CSS shown with layers
- **WHEN** a builder method is demonstrated
- **THEN** the output CSS SHALL be shown alongside with `@layer` annotations so the reader sees where each method's styles land in the cascade

### Requirement: Minimal examples written from scratch
Code examples SHALL be minimal — the simplest possible code that demonstrates the concept. Examples SHALL NOT be extracted from the showcase.

#### Scenario: Button as canonical example
- **WHEN** variants are introduced
- **THEN** the example SHALL use a Button with 2 variant axes (size and intent), not a complex multi-variant component

#### Scenario: No showcase-specific tokens in examples
- **WHEN** token references appear in examples
- **THEN** they SHALL use generic names (e.g., `'{colors.primary}'`, `'{space.md}'`) — not showcase-specific names (e.g., `'ember'`, `'coal'`, `'fire.500'`)

### Requirement: Before/after anchors for key concepts
Where a concept maps to something the reader already knows (plain CSS), the docs SHALL show a before/after translation.

#### Scenario: CSS-to-Animus translation shown
- **WHEN** `.styles()` is first introduced
- **THEN** a side-by-side SHALL show: the CSS the reader would write, and the Animus equivalent producing the same output

### Requirement: Reference pages for API lookup
Separate reference pages SHALL document the full API surface with method signatures, parameter types, and return types. These are for lookup, not learning.

#### Scenario: Builder chain reference lists all methods
- **WHEN** a user reads the builder chain reference page
- **THEN** it SHALL list every builder method with its signature, the `@layer` it emits to, and a one-line description

#### Scenario: createTheme reference lists all methods
- **WHEN** a user reads the createTheme reference page
- **THEN** it SHALL list `addBreakpoints`, `addColors`, `addColorModes`, `addScale`, `declareContextualVars`, and `build` with signatures
