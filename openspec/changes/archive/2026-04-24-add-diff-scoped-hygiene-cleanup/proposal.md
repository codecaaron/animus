> **SUPERSEDED by add-code-hygiene-protocol — not implemented.** See `openspec/changes/add-code-hygiene-protocol/` for the authoritative design.

## Why

The current hygiene stack (`verify:lint` via biome, `verify:hygiene:ts` via fallow) detects unused code but is strictly read-only. Detection without removal leaves a manual-cleanup gap that doesn't scale: authors either leave decls to rot or open sprawling all-package grooming PRs. Cross-file cleanup is also inherently multi-pass — removing an unused export may orphan its only import, which orphans another export, which eventually leaves a file with nothing left in it — but no existing single tool handles that cascade. Authors need a scoped cleanup primitive that runs against the diff they're producing, stays within its blast radius, and stops when the cascade converges.

## What Changes

- **New capability `hygiene-cleanup`**: standalone mutating workflow, not a verify tier. Verify tiers are read-only by contract; cleanup must remain separable.
- **New script `scripts/hygiene/cleanup-diff.sh`**: orchestrates a three-layer cascade scoped to `git diff <base>...HEAD`:
  - **Layer 1 (intra-file dec-stripping)**: strips unused imports, local vars, params, private class members inside diff-scoped files. Primitive selection is empirical: `biome check --write` is the default (rules `noUnusedImports`, `noUnusedVariables`, `noUnusedPrivateClassMembers` already auto-fixable); `webpro-nl/remove-unused-vars` is a fallback if biome coverage gaps are discovered during implementation.
  - **Layer 2 (cross-file export/dep cleanup)**: `fallow fix --yes` auto-removes unused exports and dependency declarations that Layer 1 may have exposed. Scoped via `fallow dead-code --changed-since <base>` for detection; `fix` is file-scoped via `--file` on the diff set.
  - **Layer 3 (empty-file deletion)**: post-pass sweep — any file in the diff scope whose remaining content is whitespace-only, comment-only, or consists entirely of re-exports-that-now-reference-nothing is deleted.
  - **Outer cascade loop**: iterates layers 1→2→3 until an iteration produces zero changes. Capped at `MAX_ITERATIONS=5` to prevent infinite loops on pathological inputs.
- **Dry-run by default**. Script prints the planned diff without mutating. Explicit `--apply` flag required to write.
- **Safety envelope on apply**: after mutation, script runs `verify:compile` + `verify:lint`. If either fails, reports the failure and exits non-zero. Does **NOT** auto-revert — user inspects the actual changes before deciding.
- **Cascade iteration cap**: each pass reports iteration count and changes-per-layer; hitting `MAX_ITERATIONS` without convergence fails loud.
- **Scope source of truth**: `git diff --name-only <base>...HEAD` filtered to `*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.cjs`. Base ref defaults to `main`; overridable via `--base <ref>` flag or `HYGIENE_BASE_REF` env var.
- **New dev-only scripts in root `package.json`**: `hygiene:preview` (calls script in default dry-run mode) and `hygiene:apply` (passes `--apply`).
- **New helper in `scripts/verify/_preconditions.sh`**: `require_hygiene_cleanup_deps` asserts biome + fallow binaries available. Reuses existing `require_fallow_binary`. NO new binary dependencies — biome and fallow are already required by existing verify tiers.
- **Root `CLAUDE.md` note**: add a sidebar in § Verification Tiers (or a new § Hygiene Workflow) pointing authors to `hygiene:preview` before PR as the inner-loop cleanup primitive. Not added to Change-Type Map — cleanup is cross-cutting and authored-opt-in, not an edit-type-triggered tier.

## Capabilities

### New Capabilities
- `hygiene-cleanup`: diff-scoped cleanup cascade combining intra-file dec-stripping, cross-file unused-export/dep auto-fix, and empty-file deletion; dry-run default with explicit apply; safety envelope + iteration cap

### Modified Capabilities
_(none — `verification-tier-policy` and `ts-static-analysis` are read-only detection surfaces; this change adds a separable mutating surface that does not alter their requirements)_

## Impact

- **New files**:
  - `scripts/hygiene/cleanup-diff.sh` (executable, orchestrates the cascade)
  - `openspec/specs/hygiene-cleanup/spec.md` (requirements)
- **Modified files**:
  - `scripts/verify/_preconditions.sh` (add `require_hygiene_cleanup_deps` helper; reuses existing `require_fallow_binary`)
  - `package.json` (add `hygiene:preview`, `hygiene:apply` dev scripts)
  - `CLAUDE.md` (add Hygiene Workflow note)
- **Binary dependencies**: none new. biome already in `verify:lint`; fallow already in `verify:hygiene:ts`. If Layer 1 empirically requires `webpro-nl/remove-unused-vars`, that becomes a `devDependency` of the root workspace; proposal does not commit to one path.
- **Blast radius**: mutating, but bounded by `git diff` file set. Dry-run default prevents accidental runs. Safety envelope (verify:compile + verify:lint post-apply) catches TS/lint regressions before merge. Files outside the diff are never touched.
- **Read-only contract**: `verify:*` tiers remain purely read-only. Cleanup is a separate, explicitly-invoked surface.
- **Out of scope**: CI wiring (policy), pre-commit hook integration (policy), automated cron runs (policy), auto-revert on safety-envelope failure (explicit deferral), any cleanup logic that mutates files outside the diff (hard boundary).
