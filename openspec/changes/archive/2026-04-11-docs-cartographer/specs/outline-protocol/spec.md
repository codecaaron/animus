# Outline Protocol

## Purpose

This spec defines the repeatable prompt for generating the Animus documentation outline. Run this once to produce the structural contract that Phase 2 (expansion) and Phase 3 (validation) execute against.

## The Prompt

```
You are planning the documentation for Animus, a zero-runtime CSS-in-JS library
for React. You are producing a DOCUMENTATION OUTLINE — not the docs themselves.

## What Animus Is

Animus uses a builder-pattern API with strict cascade ordering enforced by a
backwards-inheritance type-state machine. At build time, a Rust extractor
compiles all styling to static CSS via a Vite plugin. No runtime JS ships to
the browser.

The builder chain enforces cascade ordering via the type system:
  ds.styles() → .variant() → .compound() → .states() → .system() → .props()
Each step maps to a named CSS @layer (base, variants, compounds, states, system, custom).

Terminal methods:
  .asElement(tag) — HTML element component
  .asComponent(Component) — wraps existing React component
  .asClass() — returns className function (no React)
  .extend() — available on terminal output, creates extension chain

Composition:
  compose({ Root, Child }, { shared: { variantProp: true } })
  Distributes shared variant props from Root to Children via context.

Theming:
  createTheme() → .addScale() → .addBreakpoints() → .addColorModes() → .build()
  Produces typed token vocabulary + CSS variable declarations.

System setup:
  createSystem() → .addGroup() → .build()
  Returns { system: ds, createGlobalStyles }

Extraction:
  animusExtract({ system: './src/ds.ts', strict?, verbose? })
  Vite plugin. Runs in dev and prod. Virtual module: virtual:animus/styles.css

## Quarantine Notice

IMPORTANT: The following MDX content files exist on disk but contain STALE,
unsystematized content. Do NOT read them. Do NOT reference or attempt to
preserve their content. Treat them as blank pages to be rewritten.

Quarantined files (all under packages/showcase/src/content/):
  introduction.mdx, start.mdx,
  compiler/vite-plugin.mdx, compiler/nextjs-remix.mdx,
  architecture/theming.mdx, architecture/color-modes.mdx,
  architecture/system-setup.mdx, architecture/theme-extension.mdx,
  authoring/base-styling.mdx, authoring/variants-states.mdx,
  authoring/system-props.mdx, authoring/composition.mdx,
  advanced/typescript.mdx, advanced/framework-agnostic.mdx,
  reference/builder-chain.mdx, reference/create-theme.mdx,
  reference/create-system.mdx, reference/compose.mdx,
  support/troubleshooting.mdx

PRESERVED (do not modify):
  support/component-test.mdx (kitchen sink — exercises all doc components)
  pages/Examples.tsx (interactive test matrices — React component, not MDX)

## Source Material — READ THESE FIRST

Your primary job is DISCOVERY. Read the source to find the full API surface.
Do not rely solely on the seed inventory below — it is known to be incomplete.

Required reading (read these before writing any outline):
- packages/system/CLAUDE.md — builder chain, terminals, compose, serialization
- packages/vite-plugin/CLAUDE.md — plugin lifecycle, config, HMR
- packages/showcase/CLAUDE.md — showcase structure, verification
- packages/system/src/index.ts — all public re-exports (THE authoritative surface)
- packages/system/src/groups/index.ts — pre-built prop group exports
- packages/theming/src/index.ts — theme builder exports
- packages/core/src/index.ts — builder chain re-exports
- packages/core/src/Animus.ts — the 6-class backwards-inheritance chain (read to understand every method)
- packages/theming/src/ThemeBuilder.ts — every theme builder method
- packages/vite-plugin/src/index.ts — plugin export and config type

Deep reading (pull threads from what you find above):
- packages/core/src/types.ts — all type exports
- packages/theming/src/types.ts — theme type exports
- packages/system/src/selectors.ts — built-in selector aliases
- packages/system/src/transforms.ts — if exists, named transform definitions
- packages/showcase/src/ds.ts — real-world system setup (custom transforms, groups, global styles)

## API Surface Discovery

IMPORTANT: The inventory below is a SEED — it is known to be INCOMPLETE.
You MUST enumerate the full public API surface by reading the actual package
entry points and source files listed above. Every public export, every method
on every class, every type export, every config option.

Do not treat this list as exhaustive. Pull every thread. If you find an export
not on this list, that is ESPECIALLY important — it means coverage was
previously invisible.

### Seed Inventory (extend from source)

Builder chain methods:
  ds.styles(baseStyles)
  .variant({ prop, variants, defaultVariant? })
  .compound({ conditions, styles })
  .states({ stateName: styles })
  .system(systemPropConfig)
  .props(customPropConfig)

Terminals:
  .asElement(htmlTag), .asComponent(Component), .asClass()

Post-terminal:
  .extend() — re-enter builder chain
  .from() — theme distribution / selective spread

Composition:
  compose(slotMap, { shared? })

System factory:
  createSystem() → .addGroup(name, groupConfig) → .build()
  build() returns { system: ds, createGlobalStyles }

Theme builder:
  createTheme() → .addScale() → .addBreakpoints() → .addColorModes() → .build()
  tokens.serialize()

Pre-built groups:
  space, color, typography, layout, border, position, flex, grid, shadow, size

Plugin:
  animusExtract({ system, strict?, verbose? })

### Known Gaps in Seed (investigate and document)

These are API surface areas known to exist but NOT yet inventoried. You must
read source to find and enumerate them:

  - .includes() on system builder (cosmetic group inclusion)
  - Selector aliases: built-in (_hover, _focus, _disabled, etc.) + custom
  - Custom named transforms (e.g., fluid, ratio) and how they're registered
  - asChild pattern for headless composition
  - Token path syntax: bare keys (primary) vs template ({colors.primary})
  - Breakpoint array syntax for responsive CSS property values
  - Prop shorthand resolution (bg → background-color, px → paddingLeft + paddingRight)
  - Scale binding in custom prop definitions
  - Type exports: VariantPropsOf, ThemedCSSProps, SharedConfig, EmittedScales,
    EmittedTokenPaths, and any others found in index.ts
  - Global styles: createGlobalStyles() factory, reset layer, global layer structure
  - CSS output structure: @layer nesting, sublayers (standalone/composed), variable CSS
  - Dev vs prod behavior differences (adopted stylesheet vs file, HMR, cache)
  - Theme augmentation pattern: declare module '@animus-ui/theming'
  - Nested selector syntax within style objects
  - The serialize() contract: what it produces, what consumes it

## MDX Component Palette (verified, real, production-ready)

Use ONLY these component names in outline annotations. All exist and work.

Content display:
  <SyntaxBlock> — syntax-highlighted code with copy, collapse, line numbers, diff highlighting
  <CodeExample input="..." output="..." layout="split|stacked"> — input/output comparison
  <BeforeAfter> — two-pane comparison with header labels and copy buttons
  <LivePreview preview={} code={} variants={}> — tabbed preview + code with variant toolbar

API documentation:
  <TypeSignature name="" generics="" params={[]} returns=""> — formatted function signature
  <MethodCard name="" description="" returnType="" available="" example={}> — accordion method card
  <ParamTable params={[{ name, type, default, desc }]}> — parameter documentation table
  <TokenBadge variant="method|layer|type|prop|tag|danger|success"> — inline semantic badge
  <APIBlock> — bordered container grouping related API docs elements

Annotation:
  <Callout variant="info|tip|warn|danger" title=""> — contextual callouts
  <MetricCard value="" unit="" label="" delta={{ value, kind }}> — metric display
  <BundleBar> — horizontal bar chart for bundle size visualization

Interactive:
  <ChainStep steps={[]} activeStep={} onStepClick={}> — builder chain step visualizer
  <TabGroup tabs={[]} activeTab="" onChange={}> — tabbed content switcher
  <Button color="" kind="" size=""> — styled button for interactive examples

## Outline Format

For each PAGE, provide:

1. **Page title** and **URL slug** (matching docsNav.ts pattern: /docs/section/page)
2. **Diataxis category**: Tutorial, How-To, Explanation, or Reference
3. **Reader context**: Who is reading, what they already know, what they're trying to do
4. **Page objective**: One sentence — what can the reader DO after this page?
5. **Sections** (ordered). For each section:
   a. Section heading
   b. **Intent**: mental model? API reference? pattern demo? edge case warning?
   c. **APIs covered**: list using format `package#export.method`
   d. **MDX components**: which components from the palette above
   e. **Edge cases / non-obvious patterns**: anything a naive pass would miss
   f. **Cross-references**: other pages/sections to link to
6. **Coverage checklist**: every API this page is responsible for documenting

## Page Structure — DISCOVERY DRIVEN

The page list below is a STARTING SUGGESTION. The number and boundaries of
pages must be determined by the API surface you discover, not prescribed in
advance.

Guidelines for page boundaries:
- A page should cover a coherent conceptual unit
- If a page's coverage checklist exceeds ~15 APIs, consider splitting
- If a page's checklist has fewer than ~3 APIs, consider merging
- Every page needs enough substance for a senior dev to learn something —
  no stub pages
- Add pages freely if an API area has enough depth to warrant its own space
- The outline MUST justify any deviation from the starting suggestions

Starting suggestions (expected to grow):

  Introduction — Explanation
  Getting Started — Tutorial
  System Setup — Tutorial
  Theming & Tokens — Explanation + Reference
  Color Modes — How-To
  The Builder Chain — Explanation
  Variants & States — How-To
  System Props & Groups — How-To + Reference
  Composition — How-To
  Static Extraction — Explanation
  Plugin Configuration — Reference
  TypeScript Integration — How-To
  Troubleshooting — Reference

Areas likely to need their own pages once fully enumerated:
  - Selector aliases and nested selectors (if surface is large enough)
  - Prop shorthand and custom props (if distinct enough from system props)
  - Theme distribution (.from(), .extend() patterns — if complex enough)
  - Global styles and CSS output structure
  - Custom transforms
  - An API reference catch-all for type exports and utilities not covered
    narratively

You decide. Let the API surface dictate the page structure.

## Rules

- Every public export discovered in source must appear on exactly ONE
  page's coverage checklist. No gaps, no duplicates.
- If an API appears on a narrative page AND could appear on a reference page,
  the narrative page OWNS primary documentation. Cross-reference only.
- Mark any API you cannot fully understand from source with [VERIFY].
- Prefer showing APIs in context (narrative pages) over isolated reference.
- Do NOT read quarantined MDX files. Start from source code.
- Pull every thread: if you find a method, read its implementation to
  understand its config shape, edge cases, and relationship to other methods.
- If you discover API surface not in the seed inventory, call it out
  explicitly — these are the highest-value discoveries.
- The page count is NOT fixed. Add pages as coverage demands. Justify
  merges if you combine suggested pages.
```

## Output

The outline is written to a single markdown file. It becomes the contract for Phase 2 (docs-scribe) and the checklist for Phase 3 (docs-auditor).

## Success Criteria

- Every public export discovered in source appears on exactly one page's coverage checklist
- The outline includes APIs beyond the seed inventory (proof of real discovery)
- Every page has a Diataxis category
- Every section has at least one MDX component annotation
- No section references a component not in the palette
- Cross-references form a connected graph (no orphan pages)
- Page boundaries are justified by coverage density, not prescribed
