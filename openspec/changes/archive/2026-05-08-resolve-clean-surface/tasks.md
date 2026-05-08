## 1. Pre-flight grounding

- [x] 1.1 Confirm root `package.json` `scripts` currently contains exactly 3 clean entries: `clean`, `clean:light`, `clean:full`. DONE when `grep -E '"clean(:light|:full)?":' package.json | wc -l` returns `3`.
- [x] 1.2 Confirm `vite.config.ts` `run.tasks` does NOT yet contain clean entries. DONE when `grep -E "^      ('?clean('?:|'?:light|'?:full)?'?):" vite.config.ts` returns empty.
- [x] 1.3 Confirm vp does NOT have a built-in clean command: `bunx vp clean --help` returns `Command 'clean' not found`. DONE when output matches.
- [x] 1.4 Capture current `packages/*/dist` state for post-clean smoke test. DONE when state is observable.

## 2. vite.config.ts run.tasks additions

- [x] 2.1 In `vite.config.ts` `run.tasks`, ADD entry `clean: { command: 'rm -rf packages/*/dist packages/extract/target', cache: false }`. DONE when entry exists AND `bunx vp run clean 2>&1 | head -3` dispatches to the rm -rf command.
- [x] 2.2 In `vite.config.ts` `run.tasks`, ADD entry `'clean:light': { command: 'rm -rf node_modules/.vite packages/*/dist', cache: false }`. DONE when entry exists.
- [x] 2.3 In `vite.config.ts` `run.tasks`, ADD entry `'clean:full': { command: 'rm -rf node_modules/.vite packages/*/dist packages/extract/target packages/extract/*.node', cache: false }`. DONE when entry exists.

## 3. Root package.json edits (clean deletions + rebuild update)

- [x] 3.1 In root `package.json` `scripts`, DELETE the line `"clean": "rm -rf packages/*/dist packages/extract/target",`. DONE when `grep '"clean":' package.json` returns no match for the standalone clean script.
- [x] 3.2 In root `package.json` `scripts`, DELETE the line `"clean:light": "rm -rf node_modules/.vite packages/*/dist",`. DONE when `grep '"clean:light":' package.json` returns no match.
- [x] 3.3 In root `package.json` `scripts`, DELETE the line `"clean:full": "rm -rf node_modules/.vite packages/*/dist packages/extract/target packages/extract/*.node",`. DONE when `grep '"clean:full":' package.json` returns no match.
- [x] 3.4 In root `package.json` `scripts`, UPDATE the `rebuild` entry from `"rebuild": "bun run clean:full && vp run build:all"` to `"rebuild": "vp run clean:full && vp run build:all"`. DONE when `grep '"rebuild":' package.json` matches the new form.
- [x] 3.5 Verify `bun run clean` returns "script not found" (per CLAUDE.md dispatch convention). DONE when `bun run clean 2>&1` exits non-zero with the expected error message.

## 4. Spec MODIFIED apply

- [x] 4.1 Confirm `openspec/changes/resolve-clean-surface/specs/build-orchestration/spec.md` MODIFIED block headers match canonical exactly. Run: `grep -F "### Requirement: Clean command" openspec/specs/build-orchestration/spec.md openspec/changes/resolve-clean-surface/specs/build-orchestration/spec.md`. DONE when the header appears in BOTH files.

## 5. CLAUDE.md edits

- [x] 5.1 In `CLAUDE.md`, locate the dispatch-convention block (currently around the line containing `bun run continues to work for unmigrated scripts (clean*, dev:showcase, ...`). REMOVE `clean*, ` from the parenthetical. DONE when `grep -F 'clean*,' CLAUDE.md` returns no matches in the dispatch-convention paragraph.

## 6. Verification gate

- [x] 6.1 Run `bunx vp run verify:lint`. DONE when exit 0.
- [x] 6.2 Run `bunx vp run verify`. DONE when composite passes.
- [x] 6.3 **Smoke test (round-trip)**: run `bunx vp run clean:light`. DONE when output succeeds AND `ls packages/system/dist 2>&1 | wc -l` returns 0 (or directory missing). Then run `bunx vp run build:ts` to restore. DONE when system/dist is rebuilt with multi-entry artifacts.

## 7. Spec validation

- [x] 7.1 Run `openspec validate resolve-clean-surface --strict`. DONE when output reports `Change 'resolve-clean-surface' is valid`.

## 8. Final state-sync

- [x] 8.1 Tick all completed tasks in this file using `- [x]`. DONE when no `- [ ]` checkboxes remain in this file.
- [x] 8.2 Run `openspec status --change resolve-clean-surface`. DONE when output shows all artifacts done and `applyRequires` satisfied.
- [x] 8.3 Hand off for archive: `openspec archive resolve-clean-surface --yes`. DONE when archive applies the MODIFIED block to canonical `build-orchestration/spec.md` (`Totals: + 0, ~ 1, - 0, → 0`) AND the change directory moves to `openspec/changes/archive/YYYY-MM-DD-resolve-clean-surface/`.

## 9. Post-archive verification

- [x] 9.1 Run `openspec list --json` and confirm `resolve-clean-surface` is no longer active.
- [x] 9.2 Run `openspec validate build-orchestration --strict`. DONE when output reports `Specification 'build-orchestration' is valid`.
- [x] 9.3 Confirm `archive/YYYY-MM-DD-resolve-clean-surface/` directory exists.
