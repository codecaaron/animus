## Why

The showcase documentation (20 MDX pages across 6 sections) was written incrementally during development without a systematic coverage contract. Pages overlap in API coverage, use inconsistent depth, and reference APIs that have changed. Before the V1 release candidate merge, documentation needs a clean-slate rewrite with guaranteed API coverage and consistent structure.

Phase 1 (The Cartographer) produces the documentation outline — the structural contract that Phase 2 (docs-scribe) and Phase 3 (docs-auditor) execute against. Without this outline, content generation drifts toward gaps and duplication.

## What Changes

- Quarantine 19 existing MDX files by replacing contents with single-heading stubs (preserves dynamic routing, removes stale content)
- Produce a documentation outline mapping every public API export to exactly one page's coverage checklist
- Assign Diataxis categories (Tutorial / How-To / Explanation / Reference) to each page
- Annotate each section with MDX component assignments from the verified 23-component palette
- Establish cross-reference links between related sections

## Capabilities

### New Capabilities
- `outline-protocol`: The structured outline generation prompt — defines the outline format, coverage contract rules, real component palette, and API surface inventory. This is the repeatable prompt that produces the documentation architecture.

### Modified Capabilities

## Impact

- `packages/showcase/src/content/**/*.mdx` — 19 files stubbed (content removed, routing preserved)
- `support/component-test.mdx` and `pages/Examples.tsx` — preserved unchanged
- Produces: documentation outline consumed by Phase 2 (docs-scribe)
- No code changes. No build impact. Documentation process only.
