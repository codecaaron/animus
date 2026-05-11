## Context

MDX compiles prose to JSX. When inline code (backtick-delimited) contains nested escaped backticks (`\``), the MDX compiler can misparse the boundaries, treating `${expression}` as live JavaScript interpolation rather than literal text. This produces a `ReferenceError` at runtime when the referenced identifier doesn't exist.

The specific instance is in `packages/showcase/src/content/architecture/theming.mdx:358`:
```
`Record<name, \`var(--${string})\`>`
```

Other MDX files with `${...}` patterns were audited — all other occurrences are inside JSX string attributes (`returns="..."`) or properly escaped template literal prop values (`\`...\${...}\``), which are safe. Only prose-level nested backticks trigger this bug.

## Goals / Non-Goals

**Goals:**
- Fix the runtime ReferenceError on the theming docs page
- Use an MDX-idiomatic pattern that is unambiguous to the compiler

**Non-Goals:**
- Auditing/fixing all inline code across all MDX files (only one instance is affected)
- Changing the MDX compiler configuration or adding plugins

## Decisions

**Use `<code>{'...'}</code>` instead of backtick inline code**

When inline code content contains both backticks and `${...}` template syntax, the `<code>` JSX element with a string expression child is the only unambiguous representation. The JSX string `{'Record<name, `var(--${string})`>'}` is never parsed as a template literal.

Alternatives considered:
- `\${string}` escape in prose — already attempted (the `\`` escapes exist), doesn't resolve the backtick boundary ambiguity
- Double-backtick markdown code (` `` ... `` `) — doesn't help because the inner `${...}` is still live in MDX's JSX compilation
- HTML entity `&#96;` for backticks — works but less readable than the `<code>` pattern

## Risks / Trade-offs

- **Slight visual inconsistency**: `<code>` JSX elements should render identically to backtick inline code (both produce `<code>` HTML elements), but CSS targeting could theoretically differ. Risk is negligible since showcase styles target the `code` element generically.
