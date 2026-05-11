## Why

Phase 1 (docs-cartographer) produces a documentation outline with coverage checklists and structural annotations. That outline is a contract — it defines what goes where, but contains no prose or code examples. Phase 2 (The Scribe) takes each page from the approved outline and expands it into full MDX content.

This phase must be mechanical and disciplined: every API on a section's coverage list must appear in the output. The expansion follows type-signature-first ordering, uses the real MDX component palette, and pastes relevant TypeScript definitions as context for accurate code examples.

## What Changes

- Per-page MDX content expansion from the Phase 1 outline
- Each page written with: type signatures, minimal examples, realistic examples, edge cases
- All code examples use real Animus APIs with complete, runnable TypeScript
- MDX components from the verified palette used per the outline's annotations
- Coverage checking: every API on a section's checklist must appear in the output

## Capabilities

### New Capabilities
- `expansion-protocol`: The per-page expansion prompt — defines writing rules, code standards, prose constraints, and the RAG context pattern for pasting type definitions alongside each section's expansion.

### Modified Capabilities

## Impact

- `packages/showcase/src/content/**/*.mdx` — 19 files rewritten with full content
- Consumes: Phase 1 outline (docs-cartographer output)
- Produces: Complete MDX documentation ready for Phase 3 validation
- No code changes. No build impact. Documentation content only.
