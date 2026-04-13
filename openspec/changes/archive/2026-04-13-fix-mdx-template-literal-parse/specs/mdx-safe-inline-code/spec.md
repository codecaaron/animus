## ADDED Requirements

### Requirement: Inline code with template literal syntax renders as literal text
MDX prose containing inline code that includes backticks and `${expression}` syntax SHALL render the content as literal text, not as evaluated JavaScript expressions.

#### Scenario: Theming page renders without ReferenceError
- **WHEN** the theming docs page loads at `/architecture/theming`
- **THEN** line 358 renders `Record<name, `var(--${string})` >` as inline code text without throwing a ReferenceError

#### Scenario: Code element renders identically to backtick inline code
- **WHEN** `<code>{'content'}</code>` is used instead of backtick delimiters in MDX prose
- **THEN** the rendered HTML produces a `<code>` element with the same styling as backtick-delimited inline code
