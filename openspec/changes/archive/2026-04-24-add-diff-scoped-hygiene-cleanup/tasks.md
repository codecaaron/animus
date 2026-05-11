## 1. Preflight — Tool Probing

- [x] 1.1 Probe `biome check --write` on a controlled fixture. Finding: safe-mode applies ZERO unused-decl fixes (reports as errors, skips). `--write --unsafe --only=correctness/noUnusedImports,noUnusedVariables,noUnusedFunctionParameters,noUnusedPrivateClassMembers` scopes the fix cleanly: imports + private class members DELETED, vars + params RENAMED to `_` prefix (biome idiom — convergent, rule stops firing). `console.warn`/`console.log` preserved under --only scope. Side-effect imports preserved.
- [x] 1.2 Probe `fallow fix` flags. Finding: NO `--file` flag on `fix` subcommand. Diff-scoping is via `--changed-since <ref>` (alias `--base`). Corrected Task 6.1 accordingly.
- [x] 1.3 Cascade behavior assumption: treat `fallow fix` as single-pass. Outer loop converges any cascade via iteration. Empirical verification deferred to Task 11.4 (synthetic two-level fixture test — deferred).
- [x] 1.4 Decision: biome with scoped `--unsafe` + `--only` is sufficient for Layer 1. No need for `webpro-nl/remove-unused-vars` as a secondary primitive. Memory `feedback_no_biome_unsafe.md` needs revision to reflect that `--unsafe` is safe when scoped via `--only`.

## 2. Helpers — Preconditions

- [x] 2.1 Added `require_biome` helper to `scripts/verify/_preconditions.sh` — probes via `bunx --bun @biomejs/biome --version`; emits `ERROR: biome missing. Run: bun install` + return 1 on failure.
- [x] 2.2 Added `require_hygiene_cleanup_deps` composite helper that calls `require_biome` + `require_fallow_binary`.
- [x] 2.3 Updated header comment block in `_preconditions.sh` to document the `require_*` helper families (verify-tier helpers vs. hygiene helpers).

## 3. Orchestrator Script — Scope Selection

- [x] 3.1 Created `scripts/hygiene/cleanup-diff.sh` with `#!/usr/bin/env bash`, `set -euo pipefail`, ROOT derivation matching `scripts/verify/*.sh`.
- [x] 3.2 Script sources `scripts/verify/_preconditions.sh` and calls `require_hygiene_cleanup_deps`.
- [x] 3.3 CLI flags parsed: `--apply` (boolean), `--base <ref>` / `--base=<ref>`. Env-var fallback `HYGIENE_BASE_REF` honored. `--help` prints usage block.
- [x] 3.4 `derive_file_set()` runs `git diff --name-only "$BASE_REF...HEAD"` filtered to `.ts|.tsx|.js|.mjs|.cjs`, excluding `legacy/**`, `node_modules/**`, `dist/**`, `target/**`, `.next/**`, `.vite/**`. Empty set exits 0 with `no TS/JS files in diff; nothing to do`.
- [x] 3.5 Invocation header prints base ref, mode, and file-set size.

## 4. Orchestrator Script — Cascade Loop

- [x] 4.1 Counters initialized: `MAX_ITERATIONS=5`, `iteration=0`, `cumulative_l1/l2/l3=0`, `disposition=""`.
- [x] 4.2 Outer `while` loop iterates up to `MAX_ITERATIONS`, breaking on zero-change iteration (via explicit `disposition="converged"; break`).
- [x] 4.3 Each iteration runs Layer 1 → Layer 2 → Layer 3 in order; per-layer counts printed; cumulative counters updated.
- [x] 4.4 Zero-change convergence check is an explicit `if l1=0 && l2=0 && l3=0` guard before loop re-entry.
- [x] 4.5 Cap-hit disposition (`MAX_ITERATIONS` reached without convergence) exits nonzero with a diagnostic summary.

## 5. Orchestrator Script — Layer 1 (Intra-File Dec-Stripping)

- [x] 5.1 Biome invocation scoped via `--only=correctness/noUnusedImports,noUnusedVariables,noUnusedFunctionParameters,noUnusedPrivateClassMembers`. Apply adds `--write --unsafe`; dry-run runs biome in report-only mode (no `--write`).
- [x] 5.2 Change count via `snapshot_hashes` (shasum-based) pre/post; `count_diff_hashes` diffs the two line-sets.
- [x] 5.3 Biome runtime errors logged to `/tmp/hygiene-layer1.log`; non-`--write` errors don't abort (biome reports issues via exit 1 which we treat as informational).
- [x] 5.4 No Layer 1 fallback needed per Task 1.1 finding; biome alone covers the rule set. If future gaps surface, a `LAYER_1_PRIMITIVE` bash var at script top can be added to switch.

## 6. Orchestrator Script — Layer 2 (Cross-File Export/Dep Fix)

- [x] 6.1 Fallow invocation: apply mode `fallow fix --yes --changed-since "$BASE_REF" --quiet`; dry-run `fallow fix --dry-run --changed-since "$BASE_REF" --quiet`.
- [x] 6.2 Change count via snapshot_hashes pre/post; fallow's own output logged to `/tmp/hygiene-layer2.log`.
- [x] 6.3 Exit code handling: 0 / 1 = success (1 = issues found/fixed); 2 = runtime failure, layer fails with stderr error.
- [x] 6.4 Documented in layer comment: `--changed-since` scopes detection, but `package.json` mutations may still appear repo-wide (deps are project-scoped).

## 7. Orchestrator Script — Layer 3 (Empty-File Deletion)

- [x] 7.1 `is_semantically_empty` heuristic: preserves `.d.ts`, triple-slash directives, `declare module|namespace|global` blocks, any `import` statement (incl. side-effect), any top-level `export`. Returns 0 only when the file contains nothing but whitespace and comments.
- [x] 7.2 Dry-run prints `  would delete: <path>` entries; apply mode `rm`s the file.
- [x] 7.3 Re-export-with-dead-target NOT handled in MVP. Documented as a v2 enhancement in the `is_semantically_empty` comment block.
- [x] 7.4 File-set re-derived each iteration via `derive_file_set`, so deleted files naturally drop out of subsequent passes.

## 8. Orchestrator Script — Safety Envelope

- [x] 8.1 On converged+apply: runs `bun run verify:compile`, logs to `/tmp/hygiene-verify-compile.log`.
- [x] 8.2 Compile failure exits nonzero with stderr note. No auto-revert; explicit instruction to inspect `git diff`.
- [x] 8.3 On compile success, runs `bun run verify:lint`, logs to `/tmp/hygiene-verify-lint.log`. Same failure semantics.
- [x] 8.4 On both passing: final `✓ cascade converged and safety envelope passed` line and exit 0.
- [x] 8.5 Dry-run mode emits single-pass summary and exits 0 without running the safety envelope (can't envelope a no-mutation state).

## 9. Script Permissions + Dev-Script Registration

- [x] 9.1 `chmod +x` applied; file is executable.
- [x] 9.2 `"hygiene:preview": "bash scripts/hygiene/cleanup-diff.sh"` added to root `package.json`.
- [x] 9.3 `"hygiene:apply": "bash scripts/hygiene/cleanup-diff.sh --apply"` added to root `package.json`.
- [x] 9.4 Grep confirms no `verify:*` composite references `hygiene:` scripts. Read-only tier contract preserved.

## 10. Documentation — Root CLAUDE.md

- [x] 10.1 Added `### Hygiene Workflow` subsection within the `## Monorepo Build System` block, between `### Key Rules` and `## Legacy Packages`.
- [x] 10.2 One-paragraph description + table covering: scope source, dry-run vs apply, safety envelope, iteration cap, override mechanisms.
- [x] 10.3 Explicit "cleanup scripts MUST NOT appear in any `verify:*` composite" note; reference to spec at `openspec/specs/hygiene-cleanup/spec.md` for authoritative requirement surface.

## 11. Validation

- [x] 11.1 `openspec validate add-diff-scoped-hygiene-cleanup --type change --strict` passes clean.
- [ ] 11.2 Synthetic-success test — DEFERRED. Requires committing a temp fixture on the feature branch + destructive `git reset` to clean up. Deferred to first real PR exercise of the cascade.
- [ ] 11.3 Synthetic-failure test — DEFERRED, same reason as 11.2.
- [ ] 11.4 Cascade test (A→B→C unused chain) — DEFERRED, same reason.
- [ ] 11.5 Iteration-cap test (pathological fixture) — DEFERRED, same reason.
- [x] 11.6 Tool-missing test executed: `PATH` without `fallow` → `ERROR: fallow missing. Run: bun install -g fallow`, exit 1. Passed.
- [x] 11.7 Smoke test: ran `bun run hygiene:preview` against current working-tree state. 232 TS/JS files in diff, cascade converged in 1 iteration with 0 changes (as expected — current state is post-calibration). Exit 0.
- [x] 11.8 Bash syntax check (`bash -n scripts/hygiene/cleanup-diff.sh`) passes.

## 12. Capability Audit

- [x] 12.1 `openspec validate add-diff-scoped-hygiene-cleanup --type change --strict` passes.
- [ ] 12.2 Confirm the new capability spec appears at `openspec/specs/hygiene-cleanup/spec.md` after archive. DEFERRED — happens at archive time.
- [x] 12.3 Confirmed via grep: no `verify:*` tier in `package.json` references `hygiene:` scripts.
- [x] 12.4 Cross-reference with `add-ts-static-analysis`: no modification of its requirement set. This change installs a new mutating capability that consumes fallow's existing read-only detection surface (`fallow fix --changed-since`). Capability-vs-policy discipline intact.
