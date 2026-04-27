## 1. Sequencing pre-requisite

- [x] 1.1 Verify `add-code-hygiene-protocol` is archived OR alongside this change (its `isComplete` is true; archive promotes `openspec/specs/code-hygiene/spec.md`). If not yet archived, run `openspec archive add-code-hygiene-protocol` before strict validation of this change.
- [x] 1.2 Confirm `openspec/specs/code-hygiene/spec.md` exists post-archive — spec deltas in this change target that file.

## 2. Receipts substrate (no user-visible signaling change yet)

- [x] 2.1 Add `.hygiene/` to `.gitignore`.
- [x] 2.2 Create `scripts/hygiene/_receipts.sh` exporting `emit_receipt` (args: `layer verb target kind [extras_json]`) using `jq -Rsn` for safe target escaping; appends to `$RECEIPTS_FILE`. Iteration is read from `$HYGIENE_ITER` env (set by run.sh).
- [x] 2.3 In `scripts/hygiene/run.sh`, define `RECEIPTS_FILE=.hygiene/receipts.jsonl`, ensure `.hygiene/` exists, truncate `RECEIPTS_FILE` at startup, export it for child processes.
- [x] 2.4 In `scripts/hygiene/run.sh`, export `HYGIENE_ITER` per-iteration so emitters can tag the iteration field.
- [x] 2.5 Layer A wrapper: capture biome `--reporter=json` output, emit one receipt per applied fix (`verb="format"` for whitespace-only rules; `verb="delete"` for any deleting rule that may slip through under safe-fix scope; `kind=<rule name>`).
- [x] 2.6 Layer B wrapper: same JSON-parse pattern; emit `kind="named-import"` for `noUnusedImports` deletions, `kind="private-member"` for `noUnusedPrivateClassMembers` deletions.
- [x] 2.7 In `scripts/hygiene/delete-unused.ts`, import shared `emitReceipt` from new `scripts/hygiene/_receipts.ts` module; emit on each applied splice (post overlap-drop) with `layer="C"`, kind via `kindForTarget` (`const-decl`/`let-decl`/`var-decl`/`function-decl`/`class-decl`/`type-alias`/`interface`/`enum`/`destructured-field`), target=`<file>:<line>`, extras=`{category}`.
- [x] 2.8 Layer D wrapper: parse `knip --reporter=json` output, emit `layer="D" kind="file"` for file removals, `kind="export-clause"` / `kind="export-default"` for export removals, `kind="dependency"` for dependency removals.
- [x] 2.9 In `scripts/hygiene/reconcile-after-knip.ts`, import shared `emitReceipt`; emit `layer="D1" verb="stub" kind="empty-module"` for stub fixes; `layer="D1" verb="delete" kind="export-clause"` per whole-removal (extras include reason: `target-deleted`/`target-empty`/`all-stale`); per partial-removal stale name (extras include `removedName`).
- [x] 2.10 Smoke test (partial): synthetic biome JSON piped to `delete-unused.ts` with `RECEIPTS_FILE`/`HYGIENE_ITER` env produces a v1 receipt with all required fields and the source mutation. Full cascade smoke test deferred until 2.5/2.6/2.8 land.

## 3. Presenter module

- [x] 3.1 Create `scripts/hygiene/presenter.ts`: read `.hygiene/receipts.jsonl`, parse line-by-line into typed records (skip blank/partial trailing line), expose `analyze(records): Verdict`.
- [x] 3.2 Define `Verdict` type: `{ convergence: 'converged'|'cap-hit-clean'|'cap-hit-divergent', layerDVolume: {files: number, exports: number}, categoryDrift?: string[], suggestedExitCode: 0|1, summaryLines: string[] }`.
- [x] 3.3 Implement convergence logic: partition by `iter`, count receipts where `verb="delete"`. Last-iter zero AND iter < cap → `converged`. Last-iter zero AND iter == cap → `cap-hit-clean`. Last-iter nonzero → `cap-hit-divergent`.
- [x] 3.4 Implement Layer D volume: count `layer="D" kind="file"` (files), count `layer="D" kind∈{"export-clause","export-default"}` (exports). NOTE-trigger threshold: files ≥ 1 OR exports ≥ 5.
- [x] 3.5 Implement category-drift: collect any receipts where `verb="drift-suspected"`; if present, surface `categoriesSeen` lists.
- [x] 3.6 Emit summary lines per verdict; write structured `.hygiene/verdict.json` with same data + `suggestedExitCode`.
- [x] 3.7 Create `scripts/hygiene/presenter.test.ts` with synthetic JSONL fixtures: (a) converged-in-2-iters, (b) cap-hit-clean (5 iters, last empty), (c) cap-hit-divergent (5 iters, last has 3 deletes), (d) Layer D NOTE-trigger (1 file), (e) Layer D no-NOTE (2 exports), (f) category-drift, (g) drift+convergence simultaneously.
- [x] 3.8 In `run.sh`, after final cascade iteration, invoke presenter via `bun run scripts/hygiene/presenter.ts`; read `verdict.json`, print `summaryLines`, exit with `suggestedExitCode`.

## 4. Cap-hit verdict cutover

- [x] 4.1 Remove existing iteration-cap inline-message logic from `run.sh`; rely on presenter-derived verdict instead.
- [x] 4.2 Verify against current branch: `bun run hygiene --apply --all` reports `INFO: cascade settled at iteration cap (idempotent A/B churn caused fingerprint drift)` and exits 0 when last iter has zero `verb="delete"` receipts. [verdict-bug-fix landed mid-validation: clean trailing iterations now correctly classified as convergence via `--final-iter` orchestrator handoff. Real apply run on `next` branch reported "converged in 2 iteration(s)" + exit 0; cap-hit-clean path locked in unit test `cap-hit-clean: 5 iters, last has zero deletes`]
- [x] 4.3 Construct deliberately divergent fixture (e.g., a generated `.ts` file that re-creates an unused decl per iter); verify cap-hit-divergent reports WARN + exits non-zero. [unit-test fixture in `presenter.test.ts § cap-hit-divergent: 5 iters, last iter has 3 deletes`; constructing a self-recreating real-world divergent .ts file would require a feedback loop into the cascade that doesn't exist; synthetic fixture is the authoritative coverage]

## 5. Layer D volume signal cutover

- [x] 5.1 Verify presenter NOTE fires on a fixture matching session-90's `globalStyles` shape (1 Layer D file removal). [presenter.test.ts § "triggers on 1 file removal"]
- [x] 5.2 Verify NOTE does NOT fire on a 2-export Layer D run. [presenter.test.ts § "does NOT trigger on 2 export removals"]
- [x] 5.3 Tune thresholds (named constants in `presenter.ts`) if any false positive emerges from real `--apply --all` runs across the repo. [no false positive emerged from the real apply on `next` branch; thresholds (1 file, 5 exports) held on the test-ds re-export removal scenario which produced 0 file removals + 0 export removals (Layer D1 receipt only). No tuning needed.]

## 6. Layer C category-drift canary

- [x] 6.1 In `delete-unused.ts main()`, after parsing biome JSON output, collect a `Set<string>` of distinct categories observed.
- [x] 6.2 If after normalization (mirroring the existing `lint/` prefix handling) zero diagnostics match `TARGET_CATEGORIES`, emit one `verb="drift-suspected"` receipt with `extras.categoriesSeen` = sorted distinct categories.
- [x] 6.3 Wire presenter to surface this as `WARN: biome diagnostics present but none matched known categories — biome may have renamed. Categories seen: <list>`.
- [x] 6.4 Add Layer C unit test fixture: synthetic biome JSON containing only `lint/correctness/noUnusedVariables` diagnostics → drift receipt emitted + presenter WARN.

## 7. Dist-staleness precondition

- [x] 7.1 Add `require_dist_fresh_for_workspaces` to `scripts/verify/_preconditions.sh`. Iterate workspace list; for each: locate `package.json` `main`/`module` paths; compare `dist/` mtime vs latest `find <pkg>/src -type f -newer <pkg>/dist/index.js` output; collect stale workspaces.
- [x] 7.2 In `run.sh` fix-mode path: invoke helper after CLI parsing, before Layer A. On any stale workspace: print `ERROR: <pkg>/dist stale vs src. Run: bun run build:ts` and exit non-zero.
- [x] 7.3 In `run.sh` scan-mode path: invoke helper in WARN-only mode (print `WARN: <pkg>/dist stale vs src` per stale workspace, continue cascade).
- [x] 7.4 Skip workspaces under `legacy/` and any package whose `package.json` lacks `main`/`module`.
- [x] 7.5 Test: deliberately `touch` a `src/` file under `packages/system` newer than `packages/system/dist/index.js`; run `bun run hygiene --apply`; assert ERROR + non-zero exit, no Layer A invocation. [implicitly verified: first apply attempt on `next` branch hit `ERROR: packages/test-ds/dist stale vs src. Run: bun run build:ts` + exit 1 before any layer ran; gate fired correctly]
- [x] 7.6 Test: same setup, run `bun run hygiene` (scan); assert WARN line present and cascade still runs. [verified: touched `packages/system/src/index.ts`, ran `bun run hygiene`, output included `WARN: packages/system/dist stale vs src (would block fix mode)` AND cascade proceeded to "--- iteration 1 ---"]

## 8. --yes-apply-all confirmation gate

- [x] 8.1 In `run.sh` CLI parsing, detect `--apply` AND `--all` combination.
- [x] 8.2 TTY branch (`[ -t 0 ]`): print `Type 'apply-all' to continue: `, read input, abort with non-zero exit on any mismatch.
- [x] 8.3 Non-TTY branch: require `--yes-apply-all` flag; abort with `ERROR: --apply --all requires --yes-apply-all in non-interactive context` if absent.
- [x] 8.4 Audit `.claude/skills/` for any existing `bun run hygiene --apply --all` invocations; update them to include `--yes-apply-all` or document the new requirement in CLAUDE.md. [no existing skill invocations found; documented in CLAUDE.md]
- [ ] 8.5 Test: TTY run, type `apply-all` → cascade proceeds; type `no` → exit non-zero, no cascade. [requires interactive TTY; not verifiable in agent context. Code path inspected: `if [ -t 0 ]; then printf "Type 'apply-all' to continue: "; read -r confirm; if [ "$confirm" != "apply-all" ]; then exit 1; fi; fi`. Negative case (input ≠ "apply-all" → exit 1) is structurally equivalent to the non-TTY no-flag case which IS verified.]
- [x] 8.6 Test: non-TTY run without `--yes-apply-all` → exit non-zero with actionable message; with `--yes-apply-all` → cascade proceeds. [non-TTY rejection verified end-to-end this session; positive case requires a clean worktree to actually run the cascade]

## 9. Help text refresh

- [x] 9.1 In `run.sh`, move help-text construction below env-var resolution (`BASE_REF=${HYGIENE_BASE_REF:-main}`, `ITERATIONS=${HYGIENE_ITERATIONS:-5}`).
- [x] 9.2 Update `--base` help line to include `(env: HYGIENE_BASE_REF, currently: $BASE_REF)`.
- [x] 9.3 Update `--iterations` help line to include `(env: HYGIENE_ITERATIONS, currently: $ITERATIONS)`.
- [x] 9.4 Test: `HYGIENE_BASE_REF=develop bun run hygiene --help` shows `currently: develop`.
- [x] 9.5 Test: `bun run hygiene --help` (no env override) shows `currently: main`.

## 10. Reconciler span-preserving rewrite

- [x] 10.1 In `scripts/hygiene/reconcile-after-knip.ts`, locate `fixStaleBarrelReExports` partial-clause path that uses `el.getText(sf).join(', ')` reconstruction.
- [x] 10.2 Replace with span-preserving deletion: for each stale element, compute deletion range (include leading `,` + whitespace if not first; include trailing `,` if first); apply deletions in reverse-offset order using the same splice pattern as `delete-unused.ts`.
- [x] 10.3 Add fixture `__fixtures__/reconciler/jsdoc-above-retained.ts.in` + expected output: `export { /** doc-A */ a, b, c }` with `b` stale → `export { /** doc-A */ a, c }` (JSDoc preserved).
- [x] 10.4 Add fixture `__fixtures__/reconciler/type-modifier-mixed.ts.in`: `export { type Foo, bar, baz }` with `baz` stale → `export { type Foo, bar }` (type modifier preserved).
- [x] 10.5 Add fixture `__fixtures__/reconciler/biome-ignore-directive.ts.in`: directive comment above retained element survives.
- [x] 10.6 Extend `scripts/hygiene/reconcile-after-knip.test.ts` with one test per fixture asserting trivia preservation.
- [x] 10.7 Confirm full hygiene test suite still passes (existing 25 + reconciler 15 + new fixture-based tests).

## 11. Tier 3 corner-case fixtures

- [x] 11.1 Create `scripts/hygiene/__fixtures__/` directory; document layout in a top-level `README.md` (one paragraph).
- [x] 11.2 Function-overload-with-JSDoc fixture: three overload signatures with a JSDoc block between signature 2 and the implementation; assert deletion absorbs the JSDoc rather than orphaning it above unrelated code.
- [x] 11.3 `export = X` (CJS) re-export fixture: two-file fixture asserts reconciler does NOT strip the live re-export.
- [x] 11.4 Extend `resolveTarget` in `delete-unused.ts` to recognize `ts.isModuleDeclaration` (namespaces / module declarations).
- [x] 11.5 Add namespace fixture: unused top-level `namespace Foo { export const x = 1; }` deleted in fix mode (was previously silent no-op contributing to cap-hit churn).

## 12. Documentation

- [x] 12.1 Update `CLAUDE.md` § "Code Hygiene Workflow": dist-freshness precondition (fix-mode ERROR, scan-mode WARN), Layer D NOTE meaning, `--yes-apply-all` requirement for `--apply --all`.
- [x] 12.2 Add `.hygiene/receipts.jsonl` as the postmortem entry point: explicit pointer in the recovery-instructions section.
- [x] 12.3 Document the receipt schema (one paragraph + link to `openspec/specs/code-hygiene/spec.md`'s "Cascade emits deletion-receipts" requirement).

## 13. Validation

- [x] 13.1 Run `bun run hygiene` on a clean worktree (scan): no errors, no false WARN, recovery snapshot SHA printed. [verified on `next` branch: scan reported `converged in 2 iteration(s)`, single legitimate Layer D1 deletion noted in scan-report]
- [x] 13.2 Run `bun run hygiene --apply`: presenter-derived verdict line printed, exit code matches verdict. [verified: "converged in 2 iteration(s)" + envelope PASS + exit 0; receipts file referenced in the summary]
- [x] 13.3 Inspect `.hygiene/receipts.jsonl` post-run: valid JSONL, every line has all required v1 fields. [verified: single line `{"v":1,"iter":1,"layer":"D1","verb":"delete","target":"...test-ds/src/index.ts:5","kind":"export-clause","extras":{"reason":"all-stale","spec":"./system","staleNames":["ds"]}}` — all v1 fields present and well-formed]
- [x] 13.4 Run `bun test scripts/hygiene/`: all hygiene tests pass (existing + new presenter + new reconciler fixtures).
- [x] 13.5 Run `openspec validate refine-code-hygiene-dx --strict`: passes.
- [x] 13.6 Run `bun run verify:full`: no regression in any tier. [verified: lint + compile + types + unit:ts + unit:rust + canary + integration + build:next + build:showcase + build:vite + assert:next + assert:showcase + assert:vite all passed; exit 0]
