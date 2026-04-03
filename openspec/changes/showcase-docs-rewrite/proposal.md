## Why

The showcase docs site content is stale and architecturally misaligned. It references the old `.groups()` method (renamed to `.system()`), shows the old `.withProperties()` callback pattern (replaced by direct `.addGroup()`), and conflates CSS pseudo-classes with `.states()`. More fundamentally, the docs are organized around the framework's internal architecture, not around what a user is trying to accomplish.

The adversarial review process identified three convergent problems:
1. **Source-first documentation is engineer-brained.** Walking exports produces API reference, not learning material.
2. **The sequence is author-ordered, not learner-ordered.** Setup before first component means the reader bounces before seeing value.
3. **Too much explanation, not enough code.** Successful framework docs (Tailwind, Stitches) are 80-90% examples.

## What Changes

- **Complete rewrite of all showcase docs pages** — concept pages, API pages, getting-started guide
- **Story-driven process** — each page answers a user task ("I want to..."), not an API description
- **Cascade-first mental model** — the through-line is: every builder method accepts CSS objects with full nested selector support; the ONLY thing that changes is the cascade layer and how it's keyed (always-on, named option, condition, boolean)
- **Code-first format** — lead with copy-pasteable example, one sentence of context, link to reference
- **Minimal examples written from scratch** — not extracted from showcase (too maximalist)
- **Story inventory defines scope** — 23 stories across 4 tiers, RC minimum is stories 1-15

### Story Inventory

**Tier 1: "Does this work?"**

1. I want to install this and see something render
2. I want to style a div
3. I want hover/focus styles on it (nested selectors in any CSS object)

**Tier 2: "I'm building real components"**

4. I want named options on my component (size, intent) — `.variant()`
5. I want specific styles when two variants combine — `.compound()`
6. I want a boolean prop that applies styles at higher priority — `.states()`
7. I want spacing/color/typography as passthrough props — `.system()`
8. I want responsive values on those props — breakpoint objects

**Tier 3: "I'm building a design system"**

10. I want consistent colors across my app — `createTheme().addColors()`
11. I want dark mode and light mode — `.addColorModes()`
12. I want spacing/sizing scales — `.addScale()`
13. I want to reference theme values in styles — token ref syntax
14. I want to compose my own prop groups — `createSystem().addGroup()`
15. I want global styles — `createGlobalStyles()`
16. I want a multi-part component family — `compose()`

**Tier 2b: "I'm extending and reusing"**

17. I want to build on an existing component — `.extend()`

**Tier 3b: "Cross-cutting concerns"**

18. I want to see what TypeScript gives me — autocomplete, type errors for invalid tokens/variants
19. I want to know what happens when I make a mistake — error paths, missing `.asElement()`, invalid token refs
20. I want to organize my component files — exports, co-location, barrel patterns

**Tier 4: "I'm going deeper"**

21. Named transforms — `createTransform()`
22. Component-scoped dynamic props — `.props()`
23. Context-dependent CSS variables — `.declareContextualVars()`
24. Wrapping existing React components — `.asComponent()`
25. Class resolver without React — `.asClass()`
26. Sharing config across packages — `.includes()`
27. Next.js instead of Vite — `@animus-ui/next-plugin`

### Process: STORIES → VALIDATE → PRODUCE

**STORIES**: The inventory above defines what gets documented and in what order.

**VALIDATE**: Walk source exports, confirm every public API appears in at least one story. Orphaned exports go to API reference appendix.

**PRODUCE** per page:
1. Copy-pasteable code block (LEAD with this)
2. One sentence: when you'd reach for this
3. Before/after where useful (CSS you'd write → Animus equivalent)
4. Link to reference for full API

Per-page ratio: 80% code, 20% words.

## Capabilities

### New Capabilities
- `showcase-docs-content`: Requirements for what each docs page must contain — story coverage, code-first format, cascade-first mental model, minimal examples

### Modified Capabilities
- `developer-knowledge-docs`: Add requirement that showcase docs pages must use current API naming (`.system()` not `.groups()`, `createSystem().addGroup()` not `.withProperties()`)

## Impact

- **Files**: All markdown files in `packages/showcase/src/content/` (concepts/ and api/ subdirectories), potentially new page structure
- **No code changes**: All changes are documentation content
- **Showcase site**: Pages will render differently but the site infrastructure (markdown renderer, routing) is unchanged
- **Delegatable**: Each page in the PRODUCE phase is independently writable by an agent given the story, the source file, and the format spec
