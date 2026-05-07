## Why

Phase β (`migrate-hygiene-cascade-to-oxlint`, archived 2026-05-07) successfully migrated the hygiene cascade's tooling-side from biome to oxlint. However, the migration's scope was restricted to the cascade orchestrator and its rule-discrimination logic — the user-code-side and config-side surface was deliberately deferred.

That deferred surface is now active technical debt:

- **6 source files contain 7 `biome-ignore` directive comments** that oxlint does not parse. The comments are functionally inert: the rules they intend to suppress either aren't running (silent no-op) or are running unsuppressed (silent under-coverage). Either way, the comments lie about what's protecting the code.
- **`vite.config.ts` lint config (lines 4-44) is sparse**: no `import/order` rule (so import sorting isn't running), and no explicit overrides for the three rules the inert biome-ignore directives target (`react-hooks/exhaustive-deps`, `react/no-array-index-key`, `no-console`).
- **`.knip.json:10` references `scripts/hygiene/_emit-biome-receipts.ts`** — a file that no longer exists. Stale knip-ignore entry.
- **Canonical `code-hygiene/spec.md` has stale text**: line 392's "Binding to orchestration-architecture (vp wrap)" requirement still describes the cascade as `Layer A biome safe → B biome unsafe-scoped → C → D → D1`, contradicting the post-Phase-β reality (`Layer A oxlint-fix-suggestions → C → D → D1`, no Layer B). Line 295/309 cite `biome-ignore` as the trivia-preservation directive-syntax example — historically correct but no longer the active syntax.

Closing this loop completes Phase β's behavioral contract and removes confusion-by-stale-reference for future readers.

## What Changes

### Configuration

- **ADD** `import/order` (or oxlint's equivalent sort-imports rule) to `vite.config.ts` `lint.rules` with an explicit groups configuration matching the codebase's existing import conventions.
- **ADD** explicit `react-hooks/exhaustive-deps`, `react/no-array-index-key`, and `no-console` rule entries to `vite.config.ts` `lint.rules` at intended severity, so that the migrated disable-comments suppress concretely-configured rules rather than implicitly-enabled ones.

### Source-code directive migration (7 sites, 6 files)

- **MIGRATE** `// biome-ignore lint/correctness/useExhaustiveDependencies: ...` → `// oxlint-disable-next-line react-hooks/exhaustive-deps -- ...` at:
  - `packages/showcase/src/layout/ScrollToTop.tsx:6`
  - `packages/showcase/src/layout/Shell.tsx:73`
  - `packages/showcase/src/components/docs/PageToc.tsx:66`
- **MIGRATE** `// biome-ignore lint/suspicious/noArrayIndexKey: ...` → `// oxlint-disable-next-line react/no-array-index-key -- ...` at:
  - `packages/showcase/src/components/surfaces/SyntaxBlock.tsx:378`
  - `packages/showcase/src/components/surfaces/SyntaxBlock.tsx:409`
- **MIGRATE** `// biome-ignore lint/suspicious/noConsole: ...` → `// oxlint-disable-next-line no-console -- ...` at:
  - `packages/system/src/theme/createTheme.ts:619`
  - `packages/system/src/theme/createTheme.ts:638`

### Knip config

- **REMOVE** `"scripts/hygiene/_emit-biome-receipts.ts",` from `.knip.json` (line 10) — references a deleted file.

### Spec text alignment

- **MODIFY** `code-hygiene` capability's "Binding to orchestration-architecture" requirement to describe the post-Phase-β cascade structure (`Layer A oxlint-fix-suggestions → C → D → D1`, no Layer B) rather than the pre-Phase-β biome-era structure.
- **MODIFY** the trivia-preservation requirement's directive-syntax citation to reflect both the historical (`biome-ignore`) and active (`oxlint-disable-`) syntaxes — preserving the contract's linter-neutrality intent while updating the example.

### Out of scope

- Migrating OpenSpec spec-text references to biome that are explicitly historical-context (e.g., line 198 "historically Layer B (biome --unsafe scoped to specific rules)" — that is correct historical narrative).
- Hygiene script comments or test fixtures that exercise biome-ignore directive preservation logic (those are legitimate test coverage).
- Test-runner migration (`migrate-test-to-vp-test`), library bundler rebind, or cleaning-surface rebind — those are separate vp-arc slices.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `code-hygiene`: stale-reference cleanup in canonical spec text (binding-to-orchestration-architecture's cascade-structure description; trivia-preservation directive-syntax citation). No behavioral contract changes — this is editorial alignment with post-Phase-β reality.

## Impact

### Code

- 1 config file (`vite.config.ts`) — additions to `lint.rules`
- 1 config file (`.knip.json`) — single line removal
- 6 source files — 7 directive-comment migrations (single-line edits)

### Specs

- 1 capability (`code-hygiene`) — 2 MODIFIED requirement blocks (editorial; no contract semantics change)

### Verification

- `bunx vp lint && bunx vp fmt --check` SHALL pass post-change with the new rule overrides honored
- `bunx --bun knip` SHALL pass post-change without flagging the removed `.knip.json` entry
- `openspec validate finalize-biome-to-oxlint-residue --strict` SHALL pass with the spec deltas

### Risk

- **LOW**: enabling `import/order` may surface previously-uncaught import-order violations in existing source. The implementation tasks include a clean-pass gate before merge; if violations surface, the proposal scope expands to include a one-shot lint-fix pass. Alternative: enable as warning first, escalate to error in a follow-on.
- **LOW**: enabling explicit `no-console` / `react/no-array-index-key` rules may surface previously-uncaught violations in source files OTHER than the 4 with disable-comments. Same mitigation: clean-pass gate; expand or downgrade-to-warn if needed.
- **NONE**: spec-text MODIFIED blocks are editorial alignment with reality — no contract semantics change.

### Dependencies

None added or removed. This is purely configuration + comment-syntax + spec-text alignment.
