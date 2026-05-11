## Context

Phase β (`migrate-hygiene-cascade-to-oxlint`, archived 2026-05-07) migrated the code-hygiene cascade's tooling-side from biome to oxlint. The migration scope was tooling-side only — the cascade orchestrator, its rule-discrimination logic, and the dependency removals.

Three downstream surfaces were deliberately deferred:

1. **User-code-side `biome-ignore` directives** in 6 source files (7 total directive-comments). Phase β didn't migrate these because the syntax migration was orthogonal to cascade-side work.
2. **vite.config.ts lint config** entries for the rules that those directives target. Phase β didn't add explicit rule overrides because the cascade migration didn't require them.
3. **Stale `.knip.json` reference** to `_emit-biome-receipts.ts`, a file deleted earlier in the migration arc. Phase β didn't catch this because the file deletion happened in a sibling commit and the knip-ignore entry wasn't in the diff path.

This design also surfaces a fourth residue discovered during this proposal's scoping pass:

4. **Stale spec text** in canonical `code-hygiene/spec.md`:
   - Line 392 (inside requirement "Hygiene Entrypoint Dispatched via vp run") describes the cascade as `Layer A biome safe → B biome unsafe-scoped → C → D → D1`. This contradicts the post-Phase-β reality (`Layer A oxlint-fix-suggestions + import removal → C → D → D1`, no Layer B) and contradicts line 366 in the SAME spec which already uses oxlint terminology.
   - Line 295 (inside requirement "Reconciler partial-clause edits preserve original-source spans") cites `biome-ignore` directives as the per-element trivia example. Historically correct, but not the active syntax post-Phase-β.

The drift between line 366 (oxlint) and line 392 (biome) means a reader skimming the canonical spec gets contradictory information about the cascade's current structure. That's a real readability/correctness debt.

## Goals / Non-Goals

**Goals:**

- Restore behavioral coherence: `biome-ignore` directives in source code SHALL be migrated to `oxlint-disable-next-line` syntax with rule-name remapping, so that the migrated comments suppress concretely-configured rules.
- Restore lint coverage: `import/order` (or oxlint's equivalent sort-imports rule) SHALL be configured in `vite.config.ts` `lint.rules` so that import sorting actively runs.
- Restore config-source-of-truth: explicit rule entries for `react-hooks/exhaustive-deps`, `react/no-array-index-key`, `no-console` SHALL be added to `vite.config.ts` `lint.rules` so the migrated disable-comments suppress concretely-configured rules (not implicit-from-category rules).
- Restore knip-config accuracy: stale `.knip.json` reference to deleted `_emit-biome-receipts.ts` SHALL be removed.
- Restore spec-text accuracy: stale biome-era cascade-structure text in `code-hygiene/spec.md:392` SHALL be updated to the post-Phase-β reality; trivia-preservation example syntax SHALL include both historical (`biome-ignore`) and active (`oxlint-disable-`) directives.

**Non-Goals:**

- **Rule-coverage gap analysis** — enumerating which biome-era rules should be explicitly enabled in oxlint vs which were intentionally dropped is a separate exercise. This proposal scopes ONLY to the rules already named by existing biome-ignore directives.
- **Test-runner migration** — `migrate-test-to-vp-test` is a sibling vp-arc slice and is out of scope here.
- **Library bundler rebind** and **cleaning-surface rebind** — also out of scope (sibling vp-arc slices).
- **Formatting (`fmt:`) config changes** — the existing `fmt:` config in `vite.config.ts:45-70` is correct (Prettier-style); this proposal does NOT touch it.
- **Migrating hygiene script comments or test fixtures that exercise biome-ignore directive preservation logic** — those are legitimate historical references / test coverage, not residue.

## Decisions

### Decision 1: Migrate, don't remove, the disable-comments

**Choice:** Convert each `biome-ignore` directive to `oxlint-disable-next-line` syntax, preserving the rule's intent and the rationale text.

**Alternative considered:** Remove the disable-comments and accept whatever the new oxlint config emits.

**Rationale:** The original disable-comments encode deliberate lint-rule suppressions made by the codebase author. Removing them blindly would either (a) surface real lint violations the author already evaluated and chose to suppress, or (b) require the author to re-evaluate each site — high-cost rediscovery. Migrate-with-rationale-preserved is lower-cost and preserves intent.

### Decision 2: Add explicit rule overrides for the three previously-suppressed rules

**Choice:** Even if those rules would already be enabled-by-category (`correctness: error`, `suspicious: error`), explicitly name them in `vite.config.ts` `lint.rules` at intended severity.

**Alternative considered:** Rely on category-level enablement (current state).

**Rationale:** When a developer reads `// oxlint-disable-next-line no-console` at a use site, they want to be able to grep `vite.config.ts` for `'no-console'` and see what they're suppressing. Implicit-from-category enablement makes the disable-comment lie about the underlying state. Explicit-override makes the suppression auditable.

### Decision 3: Use `oxlint-disable-next-line` rather than file-level or block-level disables

**Choice:** Migrate every `biome-ignore` directive to `oxlint-disable-next-line` (line-scoped), matching the original biome-ignore behavior.

**Alternative considered:** File-level disable for files with multiple disables (e.g., SyntaxBlock.tsx with 2 disables, createTheme.ts with 2 disables).

**Rationale:** Line-scoped preserves the original semantic precision. File-level expands suppression scope inappropriately — future violations on lines other than the originally-protected one would be silently allowed. Maintain semantic-equivalence to the biome-ignore behavior.

### Decision 4: MODIFY the canonical spec text rather than leave it as historical narrative

**Choice:** Update `code-hygiene/spec.md:392` to describe the post-Phase-β cascade structure. Update line 295 trivia-list example to include both historical and active syntaxes.

**Alternative considered:** Leave the spec text as-is since "biome safe → biome unsafe-scoped" is historically accurate.

**Rationale:** The drift between line 366 (oxlint) and line 392 (biome) within the SAME spec creates contradictory canonical text. A reader has to know which line is "current" to extract the truth. Editorial alignment removes the ambiguity. The history is still preserved in line 372's "Earlier revisions of the cascade included Layer B..." paragraph and line 198's "historically Layer B (biome `--unsafe` scoped...)" — those legitimately ARE historical narrative and stay untouched.

### Decision 5: Defer rule-coverage gap analysis

**Choice:** Do not enumerate biome-era rules vs current oxlint coverage in this proposal.

**Alternative considered:** Include as item 4 of original scope ("optional spike").

**Rationale:** Gap analysis is open-ended and dependency on judgment calls (which dropped rules were intentional, which were oversight, which to re-add). A separate proposal is the right home for that work — different time-horizon, different review cohort, different verification gate. This proposal should ship cleanly and quickly.

## Risks / Trade-offs

**Risk 1: Enabling `import/order` surfaces violations** → Mitigation: implementation tasks include a clean-pass verification gate (`bunx vp lint && bunx vp fmt --check` MUST pass post-change). If violations surface in source files OTHER than the configured stub, scope EXPANDS to include a one-shot lint-fix pass for import order; OR the rule is downgraded to warning level for one cycle. Decision logged in tasks.md when encountered.

**Risk 2: Enabling explicit `no-console` / `react/no-array-index-key` / `react-hooks/exhaustive-deps` surfaces violations beyond the 4 currently-disable-commented sites** → Mitigation: clean-pass gate as above. If violations surface, choose between (a) one-shot fix pass within this proposal's scope, (b) downgrade-to-warn for previously-uncaught sites, or (c) add additional disable-comments at those sites with rationale.

**Risk 3: oxlint-disable-next-line syntax incompatibility surprise** → Mitigation: confirm syntax via oxlint docs OR the existing `code-hygiene/spec.md:262` "code-drift detection" pattern (which assumes oxlint-style codes via `eslint(...)` wrap unwrap). Fallback: comment-block wrapping if next-line syntax is finicky.

**Risk 4: `import/order` group configuration mismatch** → Mitigation: model groups configuration on the codebase's existing import-order convention via inspection of representative files. Default to a safe baseline (builtin → external → parent → sibling) and tighten if warranted in a follow-on.

**Trade-off: Two-step migration per directive** (rule-name remap + syntax change) → vs. one-step automated migration. We accept the two-step manual approach because the migration count is small (7 sites) and the rule-name remap requires human judgment for one-to-one mapping accuracy. An automated codemod would be over-engineered for 7 sites.

## Migration Plan

1. **Add the three explicit rule overrides + `import/order` to `vite.config.ts`** (one edit). Severity-level decision: match category default (`error`) unless violations surface.
2. **Run `bunx vp lint` and inspect output** for any violations OTHER than the 7 currently-disable-commented sites. If clean, proceed. If not, decide: fix-in-scope, downgrade-to-warn, or add additional disable-comments per Risk 2 mitigation.
3. **Migrate the 7 directive-comments** in source files (six file edits). Verify each file lints clean post-migration via `bunx vp lint <file>`.
4. **Remove `.knip.json:10`** stale entry. Verify `bunx --bun knip` passes.
5. **Apply the spec deltas** to `code-hygiene/spec.md` via this change's archive cycle.
6. **Run full verification gate**: `vp run verify:lint` (lint + fmt) clean; `bunx --bun knip` clean.
7. **Archive** via `openspec archive finalize-biome-to-oxlint-residue`.

**Rollback:** revert the commit. No data migration, no infrastructure change, no external dependency add — pure source/config edits. `git revert` is safe and complete.

## Open Questions

1. **Severity level for `import/order`**: `error` or `warn`? Default to `error` to match category style; downgrade if violation count is high.
2. **Severity level for explicit `no-console` / `react/no-array-index-key` / `react-hooks/exhaustive-deps` overrides**: `error` (matching the `correctness` and `suspicious` categories in current config) is the default lean. Confirmed during implementation if violations surface.
3. **`import/order` groups configuration**: should match codebase convention. Inspect representative files (e.g., `packages/system/src/index.ts`, `packages/showcase/src/App.tsx`) before authoring the rule entry.
