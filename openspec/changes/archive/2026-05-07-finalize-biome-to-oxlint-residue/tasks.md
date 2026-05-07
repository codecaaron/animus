## 1. Pre-flight

- [x] 1.1 Read `vite.config.ts:4-44` and confirm current `lint:` block matches the proposal's pre-state description (no `import/order`; no explicit `react-hooks/exhaustive-deps` / `react/no-array-index-key` / `no-console` rule entries; only `react/react-in-jsx-scope: 'off'` and `import/no-unassigned-import: 'off'`). DONE when current state confirmed.
- [x] 1.2 Inspect representative import-order patterns in `packages/system/src/index.ts`, `packages/showcase/src/App.tsx`, and `packages/showcase/src/components/surfaces/SyntaxBlock.tsx` to determine the codebase's existing import-grouping convention (builtin → external → parent → sibling, or codebase-specific variant). DONE when convention noted in the chosen `import/order` `groups` config.
- [x] 1.3 Confirm `bunx vp lint` runs cleanly against current HEAD (baseline). Record any pre-existing diagnostic count for comparison post-change. DONE when `bunx vp lint` exits zero (or pre-existing diagnostics are documented as the baseline). _Baseline: 0 warnings, 0 errors across 234 files._
- [x] 1.4 Confirm `bunx --bun knip` runs cleanly against current HEAD (baseline). DONE when `bunx --bun knip` exits zero or pre-existing findings are documented. _Baseline: exit 0; knip flagged stale `_emit-biome-receipts.ts` in `.knip.json` ignoreFiles — directly validates §4.1._

## 2. vite.config.ts lint config additions

- [x] 2.1 ~~In `vite.config.ts:10-13` (the `lint.rules` object), ADD entry `'import/order': ['error', { groups: <chosen groups from §1.2>, 'newlines-between': 'always' }]`~~ **REVISED**: oxlint does not provide `import/order` rule (verified — error: "Rule 'order' not found in plugin 'import'"). Import-sorting lives in oxfmt's `sortImports` config, which per vite-plus docs goes IN the `fmt:` block of `vite.config.ts` (NOT in a separate `.oxfmtrc.json` / `oxfmt.config.ts` file — vp does not load standalone oxfmt configs). FINAL placement: `sortImports` block inside `vite.config.ts` `fmt:` with `react-libs` custom group → bracketed builtin/external → internal → bracketed parent/sibling/index → unknown. DONE when `bunx vp fmt --check` runs sort-imports rules and applies them across the codebase.
- [x] 2.2 In `vite.config.ts` `lint.rules`, ADD entry `'react-hooks/exhaustive-deps': 'error'`. DONE when entry exists in the rules object.
- [x] 2.3 In `vite.config.ts` `lint.rules`, ADD entry `'react/no-array-index-key': 'error'`. DONE when entry exists in the rules object.
- [x] 2.4 In `vite.config.ts` `lint.rules`, ADD entry `'no-console': 'error'`. DONE when entry exists in the rules object.
- [x] 2.5 Run `bunx vp lint` and inspect output. **Decision logged: option (c) — scope-based overrides + targeted disable-comments.** Initial enablement surfaced 41 errors (37 `no-console`, 4 `no-array-index-key`). Resolution applied:
  - **Scope override** for `scripts/**/*.ts` + `e2e/*/scripts/**/*.ts`: `'no-console': 'off'` (CLI tooling legitimately uses console output).
  - **Scope override** for `packages/{next-plugin,vite-plugin}/src/**/*.ts`: `'no-console': 'off'` (Vite/Next plugin warnings are intended developer-facing console output per Vite plugin convention).
  - **Targeted disable-comments** at `packages/showcase/src/components/docs/ChainStep.tsx:762,764` (`react/no-array-index-key`): composite key `${s}-dot-${j}` with stable step identifier, index is fine.
  - Post-resolution: `bunx vp lint` clean (0/0 across 235 files).

## 3. Source-code directive migration (7 sites, 6 files)

- [x] 3.1 In `packages/showcase/src/layout/ScrollToTop.tsx:6`, REPLACE `// biome-ignore lint/correctness/useExhaustiveDependencies: pathname triggers scroll reset on route change` with `// oxlint-disable-next-line react-hooks/exhaustive-deps -- pathname triggers scroll reset on route change`. DONE.
- [x] 3.2 In `packages/showcase/src/layout/Shell.tsx:73`, REPLACE biome-ignore → oxlint-disable-next-line for `react-hooks/exhaustive-deps`. DONE.
- [x] 3.3 In `packages/showcase/src/components/docs/PageToc.tsx:66`, REPLACE biome-ignore → oxlint-disable-next-line for `react-hooks/exhaustive-deps`. DONE.
- [x] 3.4 In `packages/showcase/src/components/surfaces/SyntaxBlock.tsx:378`, REPLACE biome-ignore → oxlint-disable-next-line for `react/no-array-index-key`. DONE.
- [x] 3.5 In `packages/showcase/src/components/surfaces/SyntaxBlock.tsx:409`, REPLACE biome-ignore → oxlint-disable-next-line for `react/no-array-index-key`. DONE (replace_all handled both 3.4 and 3.5 in one edit; both sites independently lint clean).
- [x] 3.6 In `packages/system/src/theme/createTheme.ts:619`, REPLACE biome-ignore → oxlint-disable-next-line for `no-console`. DONE.
- [x] 3.7 In `packages/system/src/theme/createTheme.ts:638`, REPLACE biome-ignore → oxlint-disable-next-line for `no-console`. DONE (replace_all handled both 3.6 and 3.7 in one edit; both sites independently lint clean).
- [x] 3.8 Run `grep -rn "biome-ignore" packages/ --include="*.ts" --include="*.tsx"`. DONE: result is empty across `packages/`. Out-of-scope hits in `scripts/hygiene/**` (test fixtures, historical comments) are preserved as documented.

## 4. .knip.json stale reference removal

- [x] 4.1 In `.knip.json`, DELETE the line `    "scripts/hygiene/_emit-biome-receipts.ts",`. DONE — `grep -n '_emit-biome-receipts' .knip.json` returns no matches.
- [x] 4.2 Run `bunx --bun knip`. DONE — exit 0; no new diagnostics; configuration-hint about `_emit-biome-receipts.ts` is gone from output.

## 5. Verification gate

- [x] 5.1 Run `bunx vp lint`. DONE — 0 warnings, 0 errors across 235 files.
- [x] 5.2 Run `bunx vp fmt --check`. DONE — clean across change-dir; 5 pre-existing markdown drifts in canonical openspec/specs/ were whitespace-only (blank lines around headings) and were fmt'd in-flight (orthogonal to this proposal but co-shipped to clear the verify gate; non-semantic edits verified via `git diff`).
- [x] 5.3 Run `vp run verify:lint`. DONE — composite passes (lint + fmt --check both clean post-§5.2 fix).
- [x] 5.4 Run `bunx --bun knip`. DONE — exit 0.
- [x] 5.5 Run `vp run verify`. DONE — exit 0; 8/8 tiers green (lint + compile + types + unit:ts + unit:rust [279/0/1] + canary).
- [x] 5.6 Run `bun test`. DONE — 624 pass / 0 fail / 1612 expect() calls / 30 files / 1.16s. Matches baseline (no regression).

## 6. Spec validation

- [x] 6.1 Run `openspec validate finalize-biome-to-oxlint-residue --strict`. DONE — `Change 'finalize-biome-to-oxlint-residue' is valid` exit 0.
- [x] 6.2 Confirm spec delta MODIFIED-block headers match canonical exactly. DONE — both `### Requirement: Hygiene Entrypoint Dispatched via vp run` and `### Requirement: Reconciler partial-clause edits preserve original-source spans` exist verbatim in both `specs/code-hygiene/spec.md` (delta) and `openspec/specs/code-hygiene/spec.md` (canonical).

## 7. Final state-sync

- [x] 7.1 Tick all completed tasks in this file using `- [x]`. DONE.
- [x] 7.2 Confirm `openspec status --change finalize-biome-to-oxlint-residue` shows all artifacts done and apply-requires satisfied. DONE.
- [x] 7.3 Hand off to user for archive: `openspec archive finalize-biome-to-oxlint-residue` — DONE; archive applied 2 MODIFIED requirement blocks to canonical `code-hygiene/spec.md` (`Totals: + 0, ~ 2, - 0, → 0`).

## 8. Post-archive verification

- [x] 8.1 `grep -n "biome safe → B biome unsafe-scoped" openspec/specs/code-hygiene/spec.md` returns empty — stale text replaced. ✓
- [x] 8.2 `grep -n "Linter-disable directive on a retained element" openspec/specs/code-hygiene/spec.md` finds `### Scenario: Linter-disable directive on a retained element is preserved` at line 309 AND `### Scenario: oxlint-disable directive on a retained element is preserved` at line 315 — both renamed (from biome-ignore-only) AND newly-added scenarios applied. ✓
- [x] 8.3 `openspec list --json` returns `{"changes":[]}` — `finalize-biome-to-oxlint-residue` is no longer active; resides at `openspec/changes/archive/2026-05-07-finalize-biome-to-oxlint-residue/`. ✓

## In-flight notes (preserved for archival audit trail)

**Scope adjustments during apply:**

1. **§2.1 deviation (corrected mid-apply)**: oxlint does NOT have an `import/order` rule. Import-sorting in this stack is owned by oxfmt (the formatter), not oxlint. **Initial placement was wrong** — I created an `oxfmt.config.ts` file at repo root, interpreting user hints as "use a separate file." User corrected: vite-plus docs explicitly say to put fmt config IN the `fmt:` block of `vite.config.ts`; vp does not load standalone oxfmt configs. **Corrected**: deleted `oxfmt.config.ts`, restored `sortImports` block inside `vite.config.ts` `fmt:`. With sortImports actually active, 36 files needed import-sort fixup — applied via `vp fmt`. Verify gate re-run clean. _Confab-pull caught: built a story from a partial cue (user's `import { defineConfig } from 'oxfmt'` example) instead of verifying with vite-plus docs. Same anti-pattern as session 92's tsdown error misdiagnosis — adding to memory._
2. **§2.5 expansion**: 41 lint violations surfaced when explicit rules went on. Resolved via path-scoped overrides (scripts/, e2e/\*/scripts/, plugin sources) + 2 targeted disable-comments at ChainStep.tsx. Both decisions land within proposal's stated scope (Risk 2 mitigation: "add `oxlint-disable-next-line` comments at the previously-uncaught sites with rationale").
3. **§5.2 in-flight fix**: 5 pre-existing markdown drift warnings in canonical `openspec/specs/*.md` files were auto-formatted to clear the verify gate. The diffs are pure whitespace (blank lines around `## Requirements` headings, trailing-newline normalization) per `git diff` inspection — non-semantic. Co-shipped because the verify gate is mandatory and the drift is mechanical. Files affected: `build-orchestration`, `bun-workspace`, `code-hygiene`, `verification-tier-policy`, `workspace-build-ordering`.
4. **Out-of-scope discovery**: `scripts/hygiene/_emit-oxlint-receipts.ts` is now flagged by knip as an unused file (was previously masked by `_emit-biome-receipts.ts` ignore entry). Not addressed by this proposal — separate decision. The `./animus-extract.wasi.cjs` ignoreUnresolved entry in `.knip.json` is also flagged as removable; not in scope.

**File summary (final, post-correction):**

- `vite.config.ts` — added 3 explicit lint-rule entries + 2 scope overrides + `sortImports` block in `fmt:`
- `.knip.json` — removed 1 line (stale ignore-files entry)
- `packages/showcase/src/layout/ScrollToTop.tsx` — 1 directive migrated
- `packages/showcase/src/layout/Shell.tsx` — 1 directive migrated
- `packages/showcase/src/components/docs/PageToc.tsx` — 1 directive migrated
- `packages/showcase/src/components/surfaces/SyntaxBlock.tsx` — 2 directives migrated + import-sort applied
- `packages/system/src/theme/createTheme.ts` — 2 directives migrated
- `packages/showcase/src/components/docs/ChainStep.tsx` — 2 NEW disable comments added + import-sort applied
- 36 source/test files (TS/TSX) — import-sort applied via `vp fmt` once sortImports went active
- 5 canonical `openspec/specs/*.md` files — whitespace-only auto-format
- ~~`oxfmt.config.ts`~~ — was created in error, then deleted per vite-plus docs (vp does not load standalone oxfmt configs)
