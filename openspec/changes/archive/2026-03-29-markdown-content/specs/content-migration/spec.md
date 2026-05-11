## Content Migration Specification

### Overview

Migrate showcase documentation pages from inline JSX authoring to markdown content files. Each documentation topic becomes a `.md` file. Page components become thin TSX wrappers that import and render the markdown, optionally composing interactive demo components.

### File Structure

```
src/
  content/                          ← markdown content files
    concepts/
      builder-chain.md
      cascade-contract.md
      design-tokens.md
      responsive-props.md
      variants-states.md
      slot-composition.md
    api/
      create-theme.md
      create-system.md
      builder-chain.md
      create-transform.md
      prop-groups.md
      vite-plugin.md
    why.md
    getting-started.md
  demos/                            ← interactive React components
    SlotCompositionDemo.tsx
  pages/                            ← thin TSX wrappers (post-nav-restructure)
    concepts/
      BuilderChain.tsx
      CascadeContract.tsx
      DesignTokens.tsx
      ResponsiveProps.tsx
      VariantsStates.tsx
      SlotComposition.tsx
    api/
      CreateTheme.tsx
      CreateSystem.tsx
      ...
```

### Migration Rules

1. **Prose** → plain markdown paragraphs. Remove `<Prose>` wrapper, `fontSize`, `lineHeight` props (handled by component map).

2. **Headings** → markdown headings (`##`, `###`). Remove `<Heading level={N}>` wrapper.

3. **InlineCode** → backtick inline code. Remove `<InlineCode>` wrapper.

4. **CodeExample with input/output** → consecutive tsx + css fenced code blocks. Remove the `const example = { input: '...', output: '...' }` pattern and `<CodeExample code={example} />`.

5. **SyntaxBlock** → single fenced code block with language. Remove `<SyntaxBlock code={...} language={...} />`.

6. **Stack/Row layout** → removed entirely. Spacing is handled by the MarkdownContent wrapper's CSS. Layout within markdown is linear by nature.

7. **Label** → markdown emphasis or bold. `<Label>method → layer</Label>` becomes `**method → layer**` or similar.

8. **Interactive sections** (useState, onClick, live demos) → extracted to separate TSX components in `demos/`. Composed alongside markdown in the page wrapper.

### What Stays as TSX

- **Home page** (`Home.tsx`): Hero section, animated elements, CTA layout. Not documentation prose — this is a marketing/landing page.
- **Examples page** (`Examples.tsx`): Primarily interactive demonstrations.
- **Interactive demos**: Any section requiring React state, event handlers, or live component rendering. Extracted to `demos/` directory.

### Migration Sequencing

This migration is coupled with `docs-navigation-restructure`. The recommended order:

1. **Implement MarkdownContent component** (this proposal, renderer spec)
2. **Migrate one page as proof-of-concept** — Getting Started is a good candidate (sequential prose, no interactive demos, currently well-structured)
3. **Implement docs-navigation-restructure** — split pages into routes
4. **Migrate remaining pages** — each topic page is authored as .md during the split

Steps 3 and 4 can happen simultaneously — as each page is split into its own route, it's authored as markdown rather than copying the existing JSX.

### Content Extraction from Existing Pages

When migrating a page, the process is:

1. Read the existing TSX page
2. For each section, convert JSX to markdown:
   - Strip component wrappers (`Prose`, `Heading`, `Stack`, etc.)
   - Convert inline JSX to markdown syntax
   - Move code example strings into fenced code blocks
3. Identify interactive sections → extract to `demos/` component
4. Create thin page wrapper → import md + optional demo
5. Verify rendering matches original
