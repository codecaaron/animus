## 1. Pre-flight grounding

- [x] 1.1 Confirm commit 6c7475b is in HEAD's history. DONE when `git log --oneline -10 | grep -c '^6c7475b'` returns `1`.
- [x] 1.2 Confirm root `package.json` `scripts` contains no `compile`, `compile:tsc-fallback`, or `verify:compile:tsc-fallback`. DONE when `grep -c '"compile' package.json` returns `0`.
- [x] 1.3 Confirm per-package `package.json` files contain no `compile:tsc-fallback`. DONE when `grep -l 'compile:tsc-fallback' packages/*/package.json 2>/dev/null | wc -l | tr -d ' '` returns `0`.
- [x] 1.4 Confirm root `package.json` `devDependencies` no longer pins `typescript`. DONE when `grep -E '"typescript":' package.json` returns no match (the `@typescript/native-preview` line is not matched by this pattern).
- [x] 1.5 Confirm current canonical `openspec/specs/bun-workspace/spec.md` Requirement "Simplified root scripts" still references the three retired scripts. DONE when `grep -c 'compile:tsc-fallback\|verify:compile:tsc-fallback' openspec/specs/bun-workspace/spec.md` returns `≥1` (both tokens are on the same line, so line-count is 1 while token-count is 2).
- [x] 1.6 Confirm this change's MODIFIED block header matches the canonical exactly. DONE when `grep -F "### Requirement: Simplified root scripts" openspec/specs/bun-workspace/spec.md openspec/changes/retire-tsc-fallback-soak/specs/bun-workspace/spec.md` shows the header in BOTH files.

## 2. Validation gate

- [x] 2.1 Run `openspec validate retire-tsc-fallback-soak --strict`. DONE when output reports `Change 'retire-tsc-fallback-soak' is valid`.
- [x] 2.2 Confirm the change's MODIFIED block content removes ONLY the tsc-fallback-related references (the three retired scripts), with every other invariant in the requirement preserved byte-identically. DONE when a line-level diff between canonical Requirement body and the MODIFIED block body shows exactly TWO changed lines (the unmigrated-tasks paragraph and the scenario inventory bullet) with NO other content delta. **VERIFIED**: diff produced 7c7 + 13c13 only, dropping `compile (workspace-filter ad-hoc alias)`, `; compile:tsc-fallback and verify:compile:tsc-fallback (slated for removal)`, and the bare `compile,` from the scenario inventory list.

## 3. Final state-sync + archive

- [x] 3.1 Tick all completed checkboxes in this file (this section + §1 + §2 + §4). DONE when no `- [ ]` checkboxes remain.
- [x] 3.2 Run `openspec status --change retire-tsc-fallback-soak`. DONE when output reports all artifacts done.
- [ ] 3.3 Hand off for archive via openspec-archive-change skill: invoke `Skill(skill: "openspec-archive-change", args: "retire-tsc-fallback-soak")`. DONE when the change directory moves to `openspec/changes/archive/2026-05-11-retire-tsc-fallback-soak/` AND the MODIFIED block applies to canonical `openspec/specs/bun-workspace/spec.md` with totals `+ 0, ~ 1, - 0, → 0`.
- [ ] 3.4 If §3.3 archive aborts on MODIFIED (per `feedback_openspec_archive_modified_workaround`): retry with `openspec archive retire-tsc-fallback-soak --skip-specs --yes`, then manually apply the MODIFIED block content via Edit on canonical `openspec/specs/bun-workspace/spec.md`. DONE when archive directory exists AND canonical spec contains the post-modification text.

## 4. Post-archive verification

- [ ] 4.1 Confirm the three retired scripts no longer appear in the canonical spec's Requirement "Simplified root scripts". DONE when `grep -c 'compile:tsc-fallback\|verify:compile:tsc-fallback' openspec/specs/bun-workspace/spec.md` returns `0`.
- [ ] 4.2 Confirm the `compile (workspace-filter ad-hoc alias)` reference is gone from the unmigrated-tasks paragraph. DONE when `grep -F 'workspace-filter ad-hoc alias' openspec/specs/bun-workspace/spec.md` returns no match.
- [ ] 4.3 Run `openspec validate bun-workspace --strict`. DONE when output reports `Specification 'bun-workspace' is valid`.
- [ ] 4.4 Run `openspec list --json` and confirm `retire-tsc-fallback-soak` is no longer active. DONE when the change name does not appear in the active changes list.
- [ ] 4.5 Confirm `openspec/changes/archive/2026-05-11-retire-tsc-fallback-soak/` directory exists. DONE when `ls -d openspec/changes/archive/2026-05-11-retire-tsc-fallback-soak 2>&1` resolves to a directory.
