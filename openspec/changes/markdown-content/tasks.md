## 1. Dependencies & Type Setup

- [x] 1.1 Install `react-markdown` and `remark-gfm` in `packages/showcase`
- [x] 1.2 Add `*.md?raw` module declaration to showcase type environment (`src/vite-env.d.ts`)

## 2. MarkdownContent Component

- [x] 2.1 Create `MarkdownContent.tsx` in `packages/showcase/src/components/docs/`
- [x] 2.2 Define `componentMap` — map markdown elements to Animus components (Heading, Prose, InlineCode, Strong, blockquote, lists, links, hr, table/th/td)
- [x] 2.3 Implement `CodeRenderer` — dispatch between inline code (InlineCode) and block code (SyntaxBlock) based on className/language detection
- [x] 2.4 Add CodeBlockWrapper with `my: 24` for vertical spacing around code blocks
- [ ] 2.5 Implement code block pairing — detect adjacent tsx→css blocks, render as CodeExample (deferred — consecutive code blocks render individually for now)
- [x] 2.6 Add wrapper and locally-defined styled components via `ds.styles()` — ContentWrapper, CodeBlockWrapper, Anchor, BlockquoteWrapper, ListWrapper, OrderedListWrapper, ListItemStyled, Divider
- [x] 2.7 Export from `packages/showcase/src/components/index.ts`

## 3. Content Migration

- [x] 3.1 Create `src/content/` directory
- [x] 3.2 Migrate Getting Started → `src/content/getting-started.md` (GettingStarted.tsx: 231 → 5 lines)
- [x] 3.3 Migrate Why Animus → `src/content/why.md` (Why.tsx: 218 → 5 lines)
- [x] 3.4 Migrate Core Concepts → `src/content/concepts.md` + `src/demos/SlotCompositionDemo.tsx` (Concepts.tsx: 954 → 11 lines)
- [x] 3.5 Migrate API Reference → `src/content/api-reference.md` (ApiReference.tsx: 836 → 5 lines)
- [x] 3.6 Visual verification — Getting Started confirmed by user

## 4. Extraction Pipeline Fix

- [x] 4.1 Root-caused elimination gap: `collect_usage_from_expression` in `jsx_scanner.rs` did not traverse into `ObjectExpression` property values
- [x] 4.2 Added `Expression::ObjectExpression` arm — traverses into property values and spread arguments
- [x] 4.3 Rust crate rebuilds, 131 canary tests pass
- [x] 4.4 Showcase builds — MarkdownContent components (Anchor, Strong, ListWrapper, etc.) no longer eliminated
- [x] 4.5 255 tests pass, biome clean on all changed files

## 5. Document Pattern

- [ ] 5.1 Add a brief comment or section to showcase CLAUDE.md noting the markdown authoring pattern
