# `scripts/hygiene/` — End-of-Work Code Hygiene Cascade

The `verify:*` tier family is read-only by contract. This directory holds the separate **mutating** surface, invoked at end-of-work only by humans or agents — **never** by CI.

For verification tiers, see root `CLAUDE.md` § Verification Tiers. For the authoritative requirement surface, see `openspec/specs/code-hygiene/spec.md`.

## Commands

| Command                        | What it does                                                                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp run hygiene`               | Default: scan mode on files changed vs `main`. Runs the cascade non-destructively, reports what would change, restores the worktree. Requires a clean worktree (aborts otherwise).                                                             |
| `vp run hygiene --apply`       | Fix mode, changed scope. Runs the cascade destructively to convergence, then runs `verify:compile` + `verify:lint` as a safety envelope. On envelope failure: reports + exits non-zero WITHOUT auto-reverting — inspect `git diff` and decide. |
| `vp run hygiene --all`         | Scan mode, full-repo scope. Same safety semantics as default.                                                                                                                                                                                  |
| `vp run hygiene --apply --all` | Fix mode, full-repo scope. **Requires explicit confirmation**: TTY prompts `Type 'apply-all' to continue:`; non-TTY (agent) requires `--yes-apply-all`.                                                                                        |

## Cascade

Layer A oxlint safe + import removal (`vp lint --fix-suggestions` covers safe format-fixes plus unused-import deletion; `no-console` is explicitly excluded from auto-fix) → Layer C home-roll deleter (intra-file dead decls oxlint won't delete: top-level `const`/`function`/`let`/`class`/`type`/`interface`/`enum` + `namespace` + destructured-field cases) → Layer D `knip --fix` (cross-file unused exports/files/deps) → Layer D1 reconcile-after-knip (span-preserving fix-up: empty modules become `export {};`, stale barrel re-exports get the dead element span removed while retained-element trivia is preserved). Loops until git-diff stable or `--iterations=<n>` cap (default 5). Layer B was removed in Phase β: oxlint's `no-unused-private-class-members` is `#field`-only and does not fire on the TS `private` keyword Animus uses.

## Verdict (presenter-derived, receipt-based)

The orchestrator's exit code and summary are computed from `.hygiene/receipts.jsonl`, not from git-diff fingerprint stability (which is corrupted by idempotent A/B churn around whitespace/mtime). Three verdicts:

- `converged` — final iteration emitted zero deletion-receipts and the cap was not hit. Exit 0.
- `cap-hit-clean` — cap hit with zero deletes in the final iteration. Emits `INFO: cascade settled at iteration cap (idempotent A/B churn caused fingerprint drift)`. Exit 0.
- `cap-hit-divergent` — final iteration still has deletes from Layer C/D/D1. Emits `WARN: cascade did not converge — Layer <X> still deleting at iteration N`. Exit non-zero.

## Layer-Specific Notes

**Layer D NOTE**: when receipts include ≥1 `layer="D" kind="file"` OR ≥5 `layer="D" kind∈{"export-clause","export-default"}` records, the summary appends a `NOTE` recommending `vp run verify:full` before committing. Build-time-only consumers (vite virtual modules, MDX, Rust extractor) are invisible to knip; the NOTE is a nudge, not a precondition. Does NOT change exit code.

**Layer C code-drift WARN**: if oxlint reports diagnostics but ZERO of them match Layer C's `TARGET_CODES` after the `eslint(...)` wrapper is unwrapped, a `WARN: oxlint diagnostics present but none matched known codes — oxlint may have renamed.` line surfaces with the codes seen. Closes the session-89 silent-no-op regression class.

## Preconditions and Safety

**Dist-staleness precondition**: fix mode runs `require_dist_fresh_for_workspaces` before any layer. If any targeted workspace's `dist/` is older than its `src/`, fix mode exits non-zero with `ERROR: <pkg>/dist stale vs src. Run: vp run build:ts`. In scan mode the same condition emits `WARN` and the cascade continues. Knip resolves cross-workspace imports against `package.json` `main`/`module` (i.e., `dist/`); a stale dist can make knip flag live exports as unused.

**Safety envelope**: fix mode runs `vp run verify:compile` + `vp run verify:lint` after the cascade. Failure does NOT auto-revert — the orchestrator prints recovery options (hard reset / fix forward / partial-keep via `git add -p`) and exits non-zero. The failure summary references `.hygiene/receipts.jsonl` as the postmortem audit artifact.

**Recovery snapshot**: scan mode captures `git stash create` before the cascade and prints the SHA at end. Recover via `git stash store <sha> && git stash pop`.

## Configuration

**Base ref**: `--base=<ref>` or env `HYGIENE_BASE_REF=<ref>` (default `main`). Iteration cap: `--iterations=<n>` or env `HYGIENE_ITERATIONS=<n>` (default 5). `vp run hygiene --help` shows resolved defaults.

## Postmortem audit

`.hygiene/receipts.jsonl` is the structured per-layer deletion log written during the run (truncated at startup, single-run scope, gitignored). Every cascade-applied operation appends one v1-schema record:

```json
{
  "v": 1,
  "iter": 2,
  "layer": "C",
  "verb": "delete",
  "target": "packages/system/src/util.ts:42",
  "kind": "const-decl",
  "extras": { "code": "no-unused-vars" }
}
```

Required fields: `v` (schema version), `iter` (cascade iteration ≥1), `layer` (`A`|`C`|`D`|`D1`), `verb` (`delete`|`format`|`stub`|`drift-suspected`), `target` (file path with optional `:line` or `:exportName`), `kind` (semantic category like `named-import`, `const-decl`, `file`, `dependency`, `export-clause`, `code-drift`). Optional `extras` for layer-specific metadata. Parse with `jq -c` for ad-hoc queries; the spec at `openspec/specs/code-hygiene/spec.md` § "Cascade emits deletion-receipts" is authoritative.

## Contract

`vp run hygiene` (and equivalently `bash scripts/hygiene/run.sh`) MUST NOT appear in any `.github/workflows/*.yaml` step. It is end-of-work tooling invoked by humans or agents at change-completion, not a CI gate. Note: `bun run hygiene` returns "script not found" post-migration (the entry was removed from `package.json` per the hard-cutover migration), so the bun-side form is automatically excluded by absence. The `verify:*` tiers never mutate files; hygiene does. See `openspec/specs/code-hygiene/spec.md` for the authoritative requirement surface.
