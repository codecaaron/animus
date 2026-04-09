## Syntax Line Features Specification

### Requirement: SyntaxBlock highlights specific lines
SyntaxBlock SHALL accept a `highlights` prop (array of 1-based line numbers) that applies an amber glow background and highlighted line number to the specified lines.

#### Scenario: Single line highlighted
- **WHEN** SyntaxBlock renders with `highlights={[3]}`
- **THEN** line 3 has an amber-tinted background (`{colors.amber.500/8}`), a left border accent (`2px solid {colors.amber.500}`), and its line number is rendered in amber

#### Scenario: Multiple lines highlighted
- **WHEN** SyntaxBlock renders with `highlights={[2, 5, 6]}`
- **THEN** lines 2, 5, and 6 all display highlight styling, non-highlighted lines are unaffected

#### Scenario: No highlights prop
- **WHEN** SyntaxBlock renders without a `highlights` prop
- **THEN** all lines render identically to current behavior — no visual change

### Requirement: SyntaxBlock displays diff markers
SyntaxBlock SHALL accept a `diffs` prop (object mapping 1-based line numbers to `"+"` or `"-"`) that adds colored gutter markers and tinted line backgrounds.

#### Scenario: Added line
- **WHEN** SyntaxBlock renders with `diffs={{ 3: "+" }}`
- **THEN** line 3 has a forest-tinted background (`{colors.forest.500/8}`), a left border (`2px solid {colors.forest.500}`), and a `+` marker in the gutter

#### Scenario: Removed line
- **WHEN** SyntaxBlock renders with `diffs={{ 2: "-" }}`
- **THEN** line 2 has a fire-tinted background (`{colors.fire.500/6}`), a left border (`2px solid {colors.fire.500}`), and a `-` marker in the gutter

#### Scenario: Mixed diffs and highlights
- **WHEN** SyntaxBlock renders with both `highlights` and `diffs` on the same line
- **THEN** diff styling takes precedence over highlight styling

#### Scenario: No diffs prop
- **WHEN** SyntaxBlock renders without a `diffs` prop
- **THEN** all lines render without gutter markers — no visual change
