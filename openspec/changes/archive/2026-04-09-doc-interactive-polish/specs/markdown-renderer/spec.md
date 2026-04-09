## MODIFIED Requirements

### Requirement: SyntaxBlock supports line highlighting in MDX
SyntaxBlock SHALL accept `highlights` and `diffs` props when used directly in MDX via `<SyntaxBlock>` JSX. These props enhance code examples with visual markers without changing the default rendering of standard markdown code fences.

#### Scenario: MDX author uses highlights
- **WHEN** an MDX file contains `<SyntaxBlock highlights={[3, 4]} language="tsx">{code}</SyntaxBlock>`
- **THEN** lines 3 and 4 render with amber highlight styling

#### Scenario: MDX author uses diffs
- **WHEN** an MDX file contains `<SyntaxBlock diffs={{ 2: "-", 3: "+" }} language="tsx">{code}</SyntaxBlock>`
- **THEN** line 2 shows a removal marker and line 3 shows an addition marker

#### Scenario: Standard code fences unchanged
- **WHEN** an MDX file uses triple-backtick code fences without explicit SyntaxBlock JSX
- **THEN** rendering is identical to current behavior — no highlights or diffs applied
