## Purpose

Requirements for the `mdx-authoring` capability: MDX compilation pipeline; MDX component provider; Content files are MDX format; and 4 more.

## Requirements

### Requirement: MDX compilation pipeline

The showcase build SHALL compile `.mdx` files via `@mdx-js/rollup` as a Vite plugin. The plugin MUST be ordered before `react()` in the Vite plugin array. The `remarkGfm` plugin MUST be configured for table, strikethrough, and task list support.

#### Scenario: MDX file compiles to React component

- **WHEN** a `.mdx` file exists under `src/content/`
- **THEN** Vite compiles it to a React component exportable as default

#### Scenario: Plugin ordering

- **WHEN** the Vite config loads plugins
- **THEN** `mdx()` appears before `react()` in the plugin array

#### Scenario: GFM features work

- **WHEN** a `.mdx` file contains a GFM table or strikethrough syntax
- **THEN** the compiled output renders the table/strikethrough correctly

### Requirement: MDX component provider

The docs layout SHALL wrap rendered content in an `MDXProvider` that supplies the showcase component map. All standard markdown elements (headings, paragraphs, code blocks, links, lists, blockquotes, horizontal rules, tables, emphasis, strong) MUST render through the same ds-styled components as the current pipeline. The componentMap SHALL additionally include `Callout` as a custom component available without explicit import.

#### Scenario: Heading renders via component map

- **WHEN** an MDX file contains `## Section Title`
- **THEN** it renders as `<Heading level={2}>Section Title</Heading>` with auto-generated id

#### Scenario: Code fence renders via SyntaxBlock

- **WHEN** an MDX file contains a fenced code block with language `tsx`
- **THEN** it renders as `<SyntaxBlock language="tsx">` with syntax highlighting

#### Scenario: Inline code renders via InlineCode

- **WHEN** an MDX file contains `` `someCode` `` inline
- **THEN** it renders as `<InlineCode>`

#### Scenario: Callout available in componentMap

- **WHEN** an MDX file uses `<Callout variant="tip">content</Callout>` without explicit import
- **THEN** the Callout component renders with tip variant styling via the componentMap

### Requirement: Content files are MDX format

All documentation content files SHALL use the `.mdx` extension. No `.md` content files SHALL remain in `src/content/`. Each file MUST be valid MDX (JSX-safe syntax — no unescaped `<`, `>`, `{`, `}` outside of code fences or inline code spans).

#### Scenario: All content files are .mdx

- **WHEN** listing files in `src/content/`
- **THEN** every file has a `.mdx` extension

#### Scenario: No JSX parse errors

- **WHEN** the showcase builds
- **THEN** no MDX file produces a JSX syntax error from unescaped characters

### Requirement: Content glob loads modules not strings

The content discovery glob SHALL import `.mdx` files as React component modules (not raw strings). Each module's default export MUST be a renderable React component.

#### Scenario: Glob returns component modules

- **WHEN** `import.meta.glob('./content/**/*.mdx')` resolves
- **THEN** each entry's default export is a React component (callable as JSX)

#### Scenario: Lazy loading preserved

- **WHEN** a doc page route is navigated to
- **THEN** only that page's MDX module is loaded (code-split per route)

### Requirement: Live component embedding

MDX content files SHALL support importing and rendering React components inline alongside markdown prose. Components imported in an MDX file MUST render as live, interactive instances.

#### Scenario: Imported component renders live

- **WHEN** an MDX file contains `import { Button } from '../../components/docs/Button'` and `<Button color="primary" kind="fill" size="md">Click</Button>`
- **THEN** the page renders a live, interactive Button instance inline with the surrounding prose

#### Scenario: Component uses extracted styles

- **WHEN** a live component is rendered in an MDX page
- **THEN** its styles come from the extracted CSS (virtual:animus/styles.css), not runtime injection

### Requirement: Type declarations for MDX modules

The project MUST include a type declaration for `.mdx` file imports so that TypeScript resolves default imports as `ComponentType`.

#### Scenario: TypeScript accepts MDX import

- **WHEN** a `.tsx` file imports from a `.mdx` file
- **THEN** TypeScript resolves the default export as `ComponentType` without error

### Requirement: Doc component imports in MDX

MDX content files SHALL support importing and using documentation-specific components (LivePreview, TokenBadge, TypeSignature, ParamTable, MethodCard, ChainStep, TabGroup) from the showcase component barrel or relative paths. These components MUST render as interactive instances alongside markdown prose.

#### Scenario: LivePreview in MDX

- **WHEN** an MDX file imports LivePreview and renders `<LivePreview preview={<Component />} code={<SyntaxBlock>...</SyntaxBlock>} />`
- **THEN** a tabbed preview/code panel renders inline with the surrounding prose

#### Scenario: TokenBadge in MDX prose

- **WHEN** an MDX file uses `<TokenBadge variant="method">.styles()</TokenBadge>` inline
- **THEN** the semantic badge renders as an inline-flex element within the text flow

#### Scenario: Reference components in MDX

- **WHEN** an MDX file uses TypeSignature, ParamTable, or MethodCard
- **THEN** each renders as an interactive API reference component with full styling and behavior

#### Scenario: ChainStep visualization in MDX

- **WHEN** an MDX file wraps ChainStep in a client component with state management
- **THEN** the interactive chain visualization renders with clickable steps and active highlighting
