## Context

Phase 2 (docs-scribe) produces full MDX documentation. Phase 3 (The Auditor) performs technical validation against the real codebase. The auditor does NOT rewrite — it produces a constrained error report that feeds back to Phase 2 for correction.

This separation prevents validation drift: if the auditor rewrites, it becomes a second author with its own hallucination surface. Constraining output to "bulleted errors or PASS" forces precision.

## Goals / Non-Goals

**Goals:**
- Validate every API reference in Phase 2 output against actual source code
- Diff Phase 1 coverage checklists against Phase 2 mentions (find gaps)
- Check TypeScript code examples against real type signatures
- Verify extraction constraint claims match actual extractor behavior
- Produce machine-parseable error reports

**Non-Goals:**
- Rewriting or improving documentation prose
- Judging prose quality, tone, or pedagogical effectiveness
- Suggesting alternative explanations or better examples
- Validating MDX syntax (that's a build check, not a content audit)

## Decisions

### 1. Output Format: Bulleted Errors Only

Per-page output is one of:
- `PASS` — no errors found
- A bulleted list where each item is: `[ERROR_TYPE] description`

Error types:
- `[HALLUCINATED_API]` — references a method, type, prop, or config that doesn't exist in source
- `[WRONG_SIGNATURE]` — API exists but signature in example doesn't match real types
- `[MISSING_COVERAGE]` — API on Phase 1 checklist not mentioned in Phase 2 output
- `[EXTRA_COVERAGE]` — API documented on this page but owned by a different page in Phase 1
- `[WRONG_CONSTRAINT]` — extraction limitation or dev/prod behavior claim that's incorrect
- `[STALE_TOKEN]` — token name referenced doesn't exist in current theme
- `[WRONG_IMPORT]` — import path doesn't match real package exports

### 2. Validation Method: Source Grep + Type Reading

For each API referenced in a page's code examples:
1. Grep the source packages for the method/type/export name
2. If found, compare the usage in the example against the real signature
3. If not found, flag as `[HALLUCINATED_API]`

For extraction claims:
1. Read the relevant extractor source (css_generator.rs, project_analyzer.rs)
2. Verify the claimed behavior matches implementation

### 3. Coverage Diff Method

1. Parse Phase 1 outline's coverage checklist for the page
2. Parse Phase 2 output for all API mentions (method calls, type references, import statements)
3. Set difference: checklist items NOT in output = `[MISSING_COVERAGE]`
4. Items in output NOT on this page's checklist = check if they're on another page's checklist. If yes, `[EXTRA_COVERAGE]`. If no page owns them, flag as `[HALLUCINATED_API]`.

### 4. Scope Per Run

Run validation per-page, matching Phase 2's per-page expansion. This keeps context manageable and error reports actionable.

After all pages pass individually, run one cross-page consistency check:
- Same API explained differently on two pages?
- Cross-references point to sections that exist?
- Import paths consistent across examples?

## Risks / Trade-offs

### Auditor May Miss Subtle Type Errors
**Risk**: A code example uses the right method name but passes wrong argument types.
**Mitigation**: Auditor reads actual TypeScript definitions. Deep type validation (generics, conditional types) may still be missed — accept this as a known limitation. The build step (`bun run build` on showcase) is the final type-level gate.

### False Positives from Re-exported APIs
**Risk**: An API grepped for in `@animus-ui/system` might actually live in `@animus-ui/core` and be re-exported.
**Mitigation**: Auditor checks the re-export chain: system re-exports from core and theming. If found in any of the three, it's valid.

### Auditor Scope Creep
**Risk**: The auditor starts suggesting improvements or rewriting examples.
**Mitigation**: Hard constraint in the prompt: "Do not rewrite. Only output errors. If none found, output PASS." This is the single most important rule.
