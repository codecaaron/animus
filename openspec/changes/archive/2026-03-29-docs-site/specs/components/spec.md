# New Components — Functional Spec

All components are built with the Animus builder chain (`ds.styles().variant()...`). This is both a functional requirement and a dogfooding requirement — the docs site is an Animus application.

## Existing Components (reused from current showcase)

These components already exist in `src/components/` and are reused as-is or with minimal modification:

| Component | Location | Role in Docs |
|-----------|----------|-------------|
| Stack | layout/Stack.tsx | Vertical flex container, primary layout primitive |
| Row | layout/Row.tsx | Horizontal flex container |
| Slab | layout/Slab.tsx | Max-width centered container |
| Display | typography/Display.tsx | Large headings |
| Prose | typography/Prose.tsx | Body text |
| Mono | typography/Mono.tsx | Monospace text |
| Label | typography/Label.tsx | Small labels |
| SectionLabel | typography/SectionLabel.tsx | Section headers |
| Accent | typography/Accent.tsx | Italic accent text |
| SyntaxBlock | surfaces/SyntaxBlock.tsx | Syntax-highlighted code block (uses prism-react-renderer) |
| CodeFrame | surfaces/CodeFrame.tsx | Code block container |

## New Components

### Sidebar

**Purpose**: Navigation for docs pages. Renders a vertical list of links to all doc routes with active state highlighting.

**Functional Requirements**:
- Renders a list of navigation links for all `/docs/*` routes
- Uses react-router-dom `NavLink` for active state detection
- Active link must be visually distinguishable from inactive links (exact mechanism deferred to design)
- Must remain visible while scrolling docs content (sticky positioning)
- Receives route configuration as data, not hardcoded JSX — links defined as an array of `{ label, path }` objects

**Builder Chain Usage**:
- Base styles: flexDirection column, positioning
- Groups: space, surface (for background/border props)

---

### InlineCode

**Purpose**: Inline code tokens within prose text. For package names (`@animus-ui/system`), function names (`createTheme()`), file paths (`src/ds.ts`), property names (`fontSize`), values (`'primary'`).

**Functional Requirements**:
- Renders as an inline `<code>` element
- Monospace font (from tokens: `fonts.mono`)
- Visually distinct from surrounding prose text
- Must not break text flow (inline display)

**Builder Chain Usage**:
- Base styles: fontFamily, fontSize, display inline, padding, background
- No variants needed (single presentation)

---

### Heading

**Purpose**: Section headings within docs pages. h2 and h3 levels.

**Functional Requirements**:
- Renders as `<h2>` or `<h3>` based on a `level` variant
- Generates an id attribute from the heading text content (kebab-cased) for anchor linking
- Optional anchor link — clicking the heading copies the anchor URL or navigates to `#id`
- Must work with in-page scroll navigation

**Builder Chain Usage**:
- Base styles: font, weight, margin, color
- Variant: `level` with values `2` and `3` mapping to different font sizes and spacing
- Groups: space (for margin overrides)

---

### List

**Purpose**: Ordered and unordered lists for documentation content. Used in prerequisites, step lists, feature lists.

**Functional Requirements**:
- Two variants: `ordered` (ol) and `unordered` (ul)
- Renders `<ol>` or `<ul>` based on variant
- Child `<li>` elements inherit consistent spacing and typography
- Must compose with Prose-style typography (font family, size, line height)

**Builder Chain Usage**:
- Base styles: padding-left, margin, list-style
- Variant: `type` with values `ordered` and `unordered`
- Groups: space, text

---

### Table

**Purpose**: Data tables for API reference. Parameter tables, option tables, layer order tables.

**Functional Requirements**:
- Renders a `<table>` with `<thead>` and `<tbody>`
- Accepts data as structured props: `columns` (array of header labels) and `rows` (array of row arrays)
- OR: renders children directly as `<tr>`/`<th>`/`<td>` (composition model TBD based on ergonomics)
- Table cells must handle code content (InlineCode within cells)
- Horizontally scrollable if content exceeds container width

**Builder Chain Usage**:
- Table container: base styles for width, overflow, border-collapse
- Th: base styles for text-align, font-weight, padding, border-bottom
- Td: base styles for padding, border-bottom, vertical-align
- Groups: space, surface

**Note**: Table may require multiple builder chain components (TableContainer, Th, Td) composed together rather than a single monolithic component.

---

### ColorModeToggle

**Purpose**: Button that toggles between dark and light color modes. Both a docs feature (let users preview both modes) and an extraction stress test (exercises `[data-color-mode]` CSS selectors).

**Functional Requirements**:
- Toggles the `data-color-mode` attribute on the `<html>` element between `"dark"` and `"light"`
- Displays current mode state (which mode is active)
- Persists preference to localStorage (key: `animus-color-mode`)
- On page load, reads localStorage and applies saved preference before first paint (to prevent flash of wrong mode)
- Placed in the Shell nav bar (visible on all pages)

**Builder Chain Usage**:
- Base styles: cursor pointer, display, alignment
- Groups: space, surface (for hover/active states via group props)

**Stress Test Value**: Exercises the color mode token system. All semantic color tokens (primary, background, surface, text, etc.) must switch when the mode changes. This validates that the extraction pipeline correctly generates both `:root` and `[data-color-mode=light]` selector blocks.

---

### CodeExample

**Purpose**: Composite component showing authored TypeScript alongside generated CSS output. The key teaching tool — makes the extraction model tangible.

**Functional Requirements**:
- Displays two code blocks:
  - "Input" — the TypeScript builder chain (language: tsx)
  - "Output" — the generated CSS (language: css)
- Each block has a label indicating what it is
- Code content is passed as string props (not live-evaluated — these are static examples)
- Uses existing SyntaxBlock for syntax highlighting
- Variant for layout: `stacked` (vertical, input above output) or `split` (side-by-side on wide screens)

**Builder Chain Usage**:
- Container: base styles for layout
- Variant: `layout` with values `stacked` and `split`
- Groups: space, surface

**Composition**: Wraps two CodeFrame + SyntaxBlock instances. The component adds labeling and layout, not rendering logic.

---

## Component File Locations

All new components go in `src/components/` within appropriate subdirectories:

```
src/components/
  docs/              ← new subdirectory for docs-specific components
    Sidebar.tsx
    Heading.tsx
    CodeExample.tsx
    ColorModeToggle.tsx
  typography/
    InlineCode.tsx    ← alongside existing typography components
  surfaces/
    Table.tsx         ← alongside existing surface components
    List.tsx
```

## Barrel Export

All new components must be added to `src/components/index.ts` barrel export.
