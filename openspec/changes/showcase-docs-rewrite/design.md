## Context

The showcase docs site uses a markdown renderer that reads `.md` files from `packages/showcase/src/content/`. Current structure: 6 concept pages, 6 API pages, plus getting-started and home content. The markdown renderer supports code blocks with syntax highlighting. Pages are routed via React components in `pages/`.

The existing content is stale (`.groups()`, `.withProperties()`, `.withGlobalStyles()`) and organized around framework internals rather than user tasks. Three adversarial reviews converged on: start from user stories, lead with code, flip the explanation ratio.

Real usage patterns were mapped from the showcase, test fixtures, and next-test-app. Key findings:
- 80% of components are `ds.styles({...}).system({ space: true }).asElement('div')` — simple
- Nested selectors (`&:hover`, `&:focus-visible`) go in `.styles()`, not `.states()`
- States are boolean props at `@layer states` priority — any CSS object, just higher cascade
- Size + Intent is the canonical dual-variant pattern
- `.props()` is rare (1-2 components), `.compose()` is for multi-slot families
- Token aliasing is the primary way design values flow

## Goals / Non-Goals

**Goals:**
- Every docs page answers a user story ("I want to...")
- Code-first: 80% examples, 20% words
- Cascade-first mental model: same CSS objects everywhere, layer position is the only difference
- Minimal examples written from scratch (not showcase excerpts)
- RC minimum covers stories 1-15 (install through global styles)
- Each page is independently producible by an agent given the story + source + format

**Non-Goals:**
- Interactive playground or live preview (infrastructure change, separate effort)
- Exhaustive API reference (orphaned exports get a reference appendix later)
- Redesigning the showcase site itself (routing, components, visual design)
- Documenting the extraction pipeline internals

## Decisions

### 1. Page structure: guided journey + reference appendix

**Guided pages** (one per story cluster, not one per story):
- **Getting Started** — stories 1-3 (install, first component, nested selectors). Hands the reader a pre-made `ds.ts` to copy. How `createSystem` works is deferred to System Setup — the reader sees value before understanding infrastructure.
- **Variants & States** — stories 4-6, 17 (named options, compounds, boolean toggles, extending components). `.extend()` belongs here because it's the natural next step after "I built a component, now I want to build on it."
- **System Props** — stories 7-8 (prop groups, responsive values)
- **Theming** — stories 10-13 (colors, modes, scales, token refs)
- **System Setup** — stories 14-15 (addGroup, global styles). NOW the reader understands what the `ds.ts` boilerplate does.
- **Composition** — story 16 (compose for multi-slot families)
- **TypeScript & Debugging** — stories 18-19 (autocomplete, type errors, error paths). Shows the type system working as a product feature.

**Reference pages** (API surface, for lookup not learning):
- Builder Chain API (method signatures, layer mapping)
- createTheme API
- createSystem API
- compose API

**Why cluster stories?** A page per story produces 27 pages that each feel thin. Clustering related stories into 7 guided pages gives enough depth per page while keeping the count manageable. Each cluster maps to a natural "session" — you'd learn variants, states, and extend in the same sitting.

**The setup chicken-and-egg:** Getting Started must show a working component before explaining how the system is configured. The explicit strategy: provide a complete `ds.ts` boilerplate that the reader copies verbatim. The System Setup page later explains every line. This is deliberate — show value before infrastructure.

### 2. The cascade concept page is GONE

The old `cascade-contract.md` explained the layer system as a standalone concept. In the rewrite, the cascade is introduced THROUGH the examples — you see `.styles()` produce `@layer base`, then `.variant()` produce `@layer variants`, and the cascade ordering becomes obvious from the output CSS shown alongside the component code. No separate explainer needed.

### 3. Each guided page follows the same template

```
# [Title — the user task, not the API name]

[Copy-pasteable example that works]

[1-2 sentences: when you'd reach for this]

## [Next concept in the cluster]

[Example]

[Context sentence]

## What the CSS looks like

[Show the output CSS with @layer annotations]

## Going further

[Links to reference pages and next guided page]
```

### 4. Examples are minimal and written from scratch

No showcase excerpts. A Button with 2 variants (size, intent) is the canonical example component. Every concept is demonstrated on this Button or a simple Box. The showcase is the PROOF that these patterns scale — the docs show the STARTING POINT.

### 5. Before/after anchors for key concepts

Where a concept maps to something the reader already knows, show the translation:

```
/* The CSS you'd write */
.card { padding: 1rem; }
.card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }

/* The Animus equivalent */
const Card = ds
  .styles({ padding: '{space.md}', '&:hover': { boxShadow: '...' } })
  .asElement('div');
```

This anchors the reader's existing knowledge before introducing new concepts.

## Risks / Trade-offs

- **[Risk] Clustering stories might bury individual topics**: Someone searching "how do I add variants" might not find it if it's in a "Variants & States" page. → **Mitigation**: Reference pages provide direct API lookup. Guided pages have clear section headings.
- **[Risk] Minimal examples might under-represent framework power**: A 2-variant Button doesn't show what a 10-mode theme system can do. → **Mitigation**: Each guided page links to the showcase as the maximalist proof. Docs show the floor, showcase shows the ceiling.
- **[Trade-off] No interactive playground at RC**: Competing frameworks have live playgrounds. We don't. → **Accept**: Infrastructure cost is too high for RC. The copy-paste examples + `bun create` starter template fill the gap.
