## Why

LLM-generated documentation has a specific failure mode: hallucinated APIs. A code example that references `ds.styles().responsive()` looks correct but that method doesn't exist. Phase 2 (docs-scribe) produces full MDX content — Phase 3 (The Auditor) validates it against the real codebase.

The auditor's output is constrained: bulleted error lists only, no rewrites. This prevents the validator from drifting into co-authoring, which would compromise the separation between creation and review.

## What Changes

- Per-page technical validation of Phase 2 output against real source code
- API provenance checking: does every referenced method, type, and config option actually exist?
- Coverage diff: compare Phase 1 outline's checklist against actual APIs mentioned in Phase 2 output
- Type accuracy: do code examples match real TypeScript signatures?
- Extraction constraint accuracy: do warnings about static extraction match actual extractor behavior?

## Capabilities

### New Capabilities
- `validation-protocol`: The per-page validation prompt — defines validation criteria, provenance checking method, output format (bulleted errors or PASS), and the type definitions to check against.

### Modified Capabilities

## Impact

- No file modifications — validation produces error reports only
- Consumes: Phase 1 outline + Phase 2 expanded pages + source code from system/core/theming/extract
- Produces: Per-page error reports or PASS confirmations
- Errors feed back to Phase 2 for targeted correction
