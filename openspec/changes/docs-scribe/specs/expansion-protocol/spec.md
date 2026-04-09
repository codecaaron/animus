# Expansion Protocol

## Purpose

This spec defines the repeatable prompt for expanding a single page (or section) from the Phase 1 documentation outline into full MDX content. Run this once per page, pasting the relevant outline section and type definitions as context.

## The Prompt

```
You are writing documentation for Animus, a zero-runtime CSS-in-JS library.
You are expanding a single page from an approved documentation outline.

## Your Inputs

1. The OUTLINE PAGE you are expanding (pasted below as "Outline Section")
2. The SOURCE CODE for every API listed in the page's coverage checklist
3. The TypeScript TYPE DEFINITIONS relevant to this page's APIs
4. The THEME DEFINITION from packages/showcase/src/ds.ts (for token examples)

## Global Rules

Code standards:
- All code uses ds.styles() (the system instance from createSystem().build()),
  NEVER animus.styles() (legacy core import)
- All TypeScript — no `any`, no untyped variables, no `as any` casts
- Complete imports in copy-pasteable examples. No `// ...` ellipsis in
  import-dependent code. Single method call snippets may truncate.
- Token references use bare scale keys (primary, fire.500) not template
  syntax ({colors.primary}) for typed props
- No hardcoded hex/rgba values — use token refs + opacity syntax

Prose standards:
- Direct and technical. Reader is a senior frontend developer.
- Explain WHY the API is shaped this way (constraint-driven design matters)
- Explain what the extractor does with this code at build time
- Explain how the type system guides or constrains usage
- DO NOT restate what code already shows
- DO NOT explain what CSS properties do
- DO NOT use filler: "Let's dive in", "In this section we'll explore",
  "Now that we've covered X", etc.
- DO explain what happens when you break the rules (error messages,
  fallback behavior, extraction failures)

## Per-API Expansion Pattern

For each API method or feature in a section's coverage list:

1. <TypeSignature> — show the function/method signature first
2. Minimal example — smallest meaningful usage (3-8 lines of code)
3. Realistic example — how it appears in a real component (10-25 lines)
4. Edge cases or gotchas — via <Callout variant="warning"> if any were
   noted in the outline

Not every API needs all four steps. Simple utility types need only the
signature and a one-line description. Complex builder methods need the
full treatment.

## MDX Component Usage

Use ONLY these components. All are real, production-ready, and imported
from the paths shown.

Content display:
  import { SyntaxBlock } from '../../components/surfaces/SyntaxBlock'
  import { CodeExample } from '../../components/docs/CodeExample'
  import { BeforeAfter } from '../../components/docs/BeforeAfter'
  import { LivePreview } from '../../components/docs/LivePreview'

API documentation:
  import { TypeSignature } from '../../components/docs/TypeSignature'
  import { MethodCard } from '../../components/docs/MethodCard'
  import { ParamTable } from '../../components/docs/ParamTable'
  import { TokenBadge } from '../../components/docs/TokenBadge'
  import { APIBlock } from '../../components/docs/APIBlock'

Annotation:
  import { Callout } from '../../components/docs/Callout'
  import { MetricCard, MetricGrid } from '../../components/docs/MetricCard'

Interactive:
  import { ChainStep } from '../../components/docs/ChainStep'
  import { TabGroup } from '../../components/docs/TabGroup'
  import { Button } from '../../components/docs/Button'

Component usage rules:
  <Callout variant="warning"> — extraction limitations, dev vs prod differences
  <Callout variant="info"> — design reasoning, "why" explanations
  <Callout variant="tip"> — productivity shortcuts, non-obvious patterns
  <Callout variant="danger"> — breaking changes, things that will silently fail
  <CodeExample> — for showing TSX input alongside extracted CSS output
  <BeforeAfter> — for runtime-vs-extracted comparisons
  <LivePreview> — only on pages with interactive component demonstrations
  <ChainStep> — only on the builder chain page

## Coverage Contract

Every API on the outline section's coverage checklist MUST appear in your
output. If you realize an API doesn't belong on this page, say so explicitly
in a comment at the bottom:

  {/* COVERAGE NOTE: system#ds.system() moved to System Props page — see cross-ref */}

Do NOT silently drop APIs. Do NOT relocate them without flagging.

## Context Window Management

If the outline section + type definitions exceed comfortable context, split
into two passes:
  Pass A: First half of sections (write to file)
  Pass B: Second half, with Pass A as additional context
Stitch into one file. Run coverage check after stitching.

## Outline Section

<PASTE THE RELEVANT PAGE FROM THE PHASE 1 OUTLINE HERE>

## Type Definitions

<PASTE THE TYPESCRIPT TYPES FOR APIs ON THIS PAGE'S COVERAGE LIST>

## Theme Definition

<PASTE packages/showcase/src/ds.ts OR RELEVANT EXCERPTS>
```

## Output

Valid MDX file. Imports at the top. Sections matching the outline's heading structure. Coverage checklist items all accounted for.

## Success Criteria

- Every API on the page's coverage checklist is mentioned and demonstrated
- All code examples are strictly typed TypeScript using real Animus APIs
- MDX components match the outline's annotations for each section
- No fictional methods, types, props, or config options
- Prose is direct, technical, and explains "why" not just "what"
- All imports use correct paths from the real component palette
