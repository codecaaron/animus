## Context

Phase 1 (docs-cartographer) produces a structured documentation outline. Each page has: title, Diataxis category, reader context, page objective, ordered sections with intent/API coverage/MDX components/edge cases/cross-references, and a coverage checklist.

Phase 2 takes that contract and produces full MDX content. The creative decisions (what goes where, page framing, API grouping) were made in Phase 1. Phase 2 is disciplined expansion — type signatures first, then examples, then edge cases.

The showcase has 23 verified MDX components. All are real and production-ready. No new components need to be built.

## Goals / Non-Goals

**Goals:**
- Expand every section in the Phase 1 outline into complete MDX with prose + code
- Ensure every API on each section's coverage list appears in the output
- Produce runnable, strictly-typed code examples using real Animus APIs
- Use MDX components as annotated in the outline (not improvised)
- Write for senior frontend developers — no filler, no explaining what CSS properties do

**Non-Goals:**
- Restructuring pages (that's Phase 1's job — follow the outline)
- Building new components or modifying existing ones
- Validating correctness (that's Phase 3's job)
- Writing marketing copy or philosophical framing beyond what the outline specifies

## Decisions

### 1. Expansion Pattern: Type Signature First

For each API method in a section:
1. `<TypeSignature>` showing the function/method signature
2. Minimal example (smallest meaningful usage — 3-5 lines)
3. Realistic example (how it appears in a real component — 10-20 lines)
4. Edge cases or gotchas via `<Callout variant="warning">`

This mirrors how experienced developers read docs: shape first, then example, then traps.

### 2. RAG Context Pattern: Paste Types Per Page

Each page expansion receives:
- The outline section being expanded (from Phase 1 output)
- The TypeScript type definitions for every API on that section's coverage list
- The source code of relevant builder/theme/compose implementations

This prevents the expander from guessing at API shapes. The types ARE the source of truth.

### 3. Code Standards

- All code uses `ds.styles()` (the system instance), never `animus.styles()` (legacy core import)
- All TypeScript — no `any`, no untyped variables
- Complete imports in copy-pasteable examples (not `// ...` ellipsis)
- Token references use bare scale keys (`primary`, `fire.500`) not template syntax (`{colors.primary}`) for typed props
- No hardcoded hex/rgba values — token refs + opacity syntax for everything

### 4. Prose Standards

- Direct and technical. Assume senior frontend developer reader.
- Explain WHY the API is shaped this way (constraint-driven design)
- Explain what the extractor does with this code at build time
- Explain how the type system guides/constrains usage
- Do NOT restate what code already shows
- Do NOT explain what CSS properties do
- Do NOT use filler transitions ("Let's dive in", "In this section we'll explore")

### 5. MDX Component Usage

- `<Callout variant="warning">` for extraction limitations, dev/prod behavior differences
- `<Callout variant="info">` for design reasoning ("why" explanations)
- `<Callout variant="tip">` for productivity shortcuts or non-obvious patterns
- `<CodeExample>` for showing TSX input alongside extracted CSS output
- `<BeforeAfter>` for runtime-vs-extracted comparisons
- `<LivePreview>` only on pages with interactive component demos
- `<ChainStep>` only on the builder chain page

### 6. Per-Page Context Window Management

Some pages cover many exports. If a single page's outline + types exceed comfortable context, split into two passes:
- Pass A: First half of sections
- Pass B: Second half, with Pass A output as additional context for cross-referencing

Stitch passes into one file. Coverage check after stitching.

## Risks / Trade-offs

### Phase 2 Output May Deviate from Outline
**Risk**: The expander makes creative decisions that contradict Phase 1 structure.
**Mitigation**: The expansion prompt explicitly constrains: "If you realize an API doesn't belong here, say so explicitly — don't silently drop it or relocate it."

### Code Examples May Reference Non-Existent APIs
**Risk**: LLM generates plausible-looking but fictional method calls.
**Mitigation**: Phase 3 (docs-auditor) catches this. Phase 2's job is to write; Phase 3's job is to validate. Separation of concerns.

### Token Values May Be Stale
**Risk**: Code examples reference token names that exist in theme but have changed.
**Mitigation**: RAG context includes the actual theme definition from `ds.ts`. Expander uses those exact token names.
