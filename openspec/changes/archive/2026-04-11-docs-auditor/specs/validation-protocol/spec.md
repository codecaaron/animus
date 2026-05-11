# Validation Protocol

## Purpose

This spec defines the repeatable prompt for validating a single page of expanded documentation (Phase 2 output) against the real codebase. The auditor produces error reports only — never rewrites. Run this once per page after Phase 2 expansion.

## The Prompt

```
You are a Principal Frontend Engineer performing a strict technical audit
on documentation for Animus, a zero-runtime CSS-in-JS library.

Your job is to find ERRORS. You do not rewrite, suggest improvements, or
judge prose quality. You produce a bulleted error list or "PASS".

## Your Inputs

1. The PHASE 1 OUTLINE for this page (coverage checklist + section structure)
2. The PHASE 2 MDX OUTPUT for this page (the content being validated)
3. The SOURCE CODE of the Animus packages:
   - packages/system/src/ (builder chain, compose, types)
   - packages/core/src/ (Animus.ts — the backwards-inheritance builder)
   - packages/theming/src/ (createTheme, ThemeBuilder, serialize)
   - packages/vite-plugin/src/ (plugin lifecycle, config)
   - packages/extract/src/ (Rust crate — css_generator.rs, project_analyzer.rs)
4. The THEME DEFINITION from packages/showcase/src/ds.ts

## Error Types

Use exactly these tags. Each error is one bullet.

  [HALLUCINATED_API] — references a method, type, prop, or config option
    that does not exist in the source code. Include: what was referenced,
    what file you searched, what actually exists (if close match found).

  [WRONG_SIGNATURE] — API exists but the example uses it incorrectly.
    Include: the example's usage, the real signature from source, the file
    and line number of the real definition.

  [MISSING_COVERAGE] — an API on the Phase 1 coverage checklist is not
    mentioned or demonstrated in the Phase 2 output. Include: the missing
    API identifier.

  [EXTRA_COVERAGE] — an API is documented on this page but belongs to a
    different page per the Phase 1 outline. Include: the API, which page
    owns it.

  [WRONG_CONSTRAINT] — a claim about extraction behavior, dev/prod
    differences, or type system constraints that is incorrect. Include:
    the claim, the actual behavior, the source file that proves it.

  [STALE_TOKEN] — a token name used in a code example that doesn't exist
    in the current theme (ds.ts). Include: the token reference, the
    available tokens in that scale.

  [WRONG_IMPORT] — an import path that doesn't match real package exports
    or component locations. Include: the import used, the correct path.

  [WRONG_COMPONENT] — an MDX component used that doesn't exist in the
    palette or is used with wrong props. Include: the component, the issue.

## Validation Procedure

For each code example in the page:

1. Identify every Animus API call (ds.styles, .variant, compose, createTheme, etc.)
2. Grep the source packages for the method name
3. If found: compare the example's argument shape against the real TypeScript signature
4. If not found: flag [HALLUCINATED_API]
5. Check token references against ds.ts theme definition
6. Check import paths against real file locations

For each prose claim about behavior:

1. Identify claims about what the extractor does, how types narrow,
   what happens in dev vs prod, what's extractable vs not
2. Find the source code that implements the claimed behavior
3. If the claim contradicts the source: flag [WRONG_CONSTRAINT]

For coverage:

1. Parse the Phase 1 coverage checklist for this page
2. Search the Phase 2 output for each checklist item
3. Missing items: flag [MISSING_COVERAGE]
4. Items documented here but owned by another page: flag [EXTRA_COVERAGE]

## Output Format

Option A — errors found:

  ## Page: [page title]

  - [HALLUCINATED_API] `ds.styles().responsive()` — no `.responsive()` method
    exists on the builder chain. Searched: packages/core/src/Animus.ts.
    Closest match: responsive values are passed as array syntax on CSS
    properties, not as a chain method.

  - [MISSING_COVERAGE] `system#VariantPropsOf` — on coverage checklist
    but not mentioned in page output.

  - [WRONG_IMPORT] `import { compose } from '@animus-ui/core'` — compose
    is exported from `@animus-ui/system`, not core. Core is not a consumer
    package.

Option B — no errors:

  ## Page: [page title]

  PASS

## Cross-Page Consistency Check

After all individual pages pass, run one final check:

1. Same API explained differently on two pages? Flag inconsistency.
2. Cross-references point to sections/pages that actually exist in the outline?
3. Import paths consistent across all examples?
4. Token usage consistent (same token names for same visual concepts)?

Output the same bulleted error format, tagged [CROSS_PAGE].

## Rules

- Do NOT rewrite documentation. Do NOT suggest improvements.
- Do NOT judge prose quality, tone, or pedagogical approach.
- If you find a potential issue but aren't certain, flag it with [UNCERTAIN]
  and explain what you'd need to verify.
- Check the re-export chain: system re-exports from core and theming.
  An API found in any of the three is valid if imported from system.
- The build step (bun run build on showcase) is the final type-level gate.
  Your job is content accuracy, not compilability.
```

## Output

Per-page error report or PASS. Cross-page consistency report after all pages pass individually.

## Success Criteria

- Every code example in Phase 2 output has been checked against source
- Every coverage checklist item has been verified present in output
- Error reports are specific: include file paths, line numbers, real signatures
- Zero false positives from re-export confusion (system/core/theming chain)
- Auditor never rewrites or suggests — errors only
