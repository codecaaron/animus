## Why

Agents and humans routinely finish changes carrying dead artifacts — unused imports, unused local variables, unused exports, orphaned files, unused `package.json` deps — that nobody remembers adding. The repo currently has no deterministic end-of-work checkpoint for "my diff contains nothing unused."

Two prior in-flight changes (`add-diff-scoped-hygiene-cleanup` and `add-ts-static-analysis`) attempted this via a fallow-based cascade, but verification this session surfaced structural problems: (1) fallow is 6× slower than knip on this repo, (2) the `remove-unused-vars` package they planned to use as an intra-file deleter is broken against biome 2.x (its own test suite fails 7/7 on biome; dev-dep was bumped silently without a parser update), (3) the two changes' scope bled between read-only verification and mutating cleanup in ways that muddled the boundary between `verify:*` (read-only by contract) and actual file mutation. This change cuts those knots with a clean three-tool cascade explicitly scoped to end-of-work tooling, not CI, and supersedes both prior changes without crediting them toward the new capability.

## What Changes

- **New capability `code-hygiene`** with single flag-driven entrypoint `bun run hygiene` — `scan + changed` by default (end-of-work ergonomic), `--apply` mutates, `--all` widens to full repo.
- **Cascade**: biome safe pass → biome unsafe-scoped DELETE pass (only `noUnusedImports` + `noUnusedPrivateClassMembers` — the two rules biome deletes cleanly) → home-roll biome-JSON deleter (reads biome `--reporter=json` for `noUnusedVariables` diagnostics, uses `typescript` compiler API to delete the enclosing declaration at reported coordinates) → `knip --fix`. Loop to convergence or iteration cap.
- **Install `knip@^6`** as new root devDependency. Fresh `.knip.json` written from scratch; no port of `.fallowrc.json` structure.
- **Home-roll deleter** at `scripts/hygiene/delete-unused.ts` (~100-150 LOC TypeScript, bun-runnable, no new external dependency — uses the `typescript` devDep already present).
- **Orchestrator** at `scripts/hygiene/run.sh` handles mode/scope flags, iteration loop, and safety envelope.
- **Precondition helpers** in `scripts/verify/_preconditions.sh`: `require_knip_binary`, `require_typescript`, `require_code_hygiene_deps` (composite).
- **Safety envelope** on `fix` mode: `bun run verify:compile` + `bun run verify:lint` post-cascade; on failure, report and bail (no auto-revert — human/agent inspects `git diff`).
- **Explicit exclusions**: biome's `noUnusedVariables` / `noUnusedFunctionParameters` unsafe auto-fixes (both rename to `_`-prefix) are NOT invoked — rename-as-fix is rejected for top-level decls (maintainability poison); positional-param rename is left as a biome warning for human review since arity-preservation is correct behavior.
- **CLAUDE.md** gains a `### Code Hygiene Workflow` section documenting invocation, semantics, and safety envelope; any `verify:hygiene:ts` / fallow / `.fallowrc.json` references removed.
- **BREAKING (openspec-layer only, no runtime impact)**: `add-diff-scoped-hygiene-cleanup` and `add-ts-static-analysis` are archived without implementation credit. Their draft specs (`hygiene-cleanup`, `ts-static-analysis`) never reached `openspec/specs/` and are discarded, not promoted.

## Capabilities

### New Capabilities
- `code-hygiene`: End-of-work (not CI) deterministic cleanup of unused-code artifacts across the TypeScript surface — unused imports, unused variables at any scope (with DELETE semantics, not rename), unused cross-file exports, unused files, unused dependencies. Two scopes (changed-only via git-diff base ref, full-repo) × two modes (scan-only or fix with safety envelope). Agent- and human-invocable. Explicitly distinct from `verify:*` tiers, which remain read-only by contract.

### Modified Capabilities
<!-- None. Neither `hygiene-cleanup` nor `ts-static-analysis` was ever promoted to `openspec/specs/` — both are in-flight drafts being superseded. No REMOVED deltas required. -->

## Impact

- **New files**: `scripts/hygiene/run.sh`, `scripts/hygiene/delete-unused.ts`, `scripts/hygiene/delete-unused.test.ts` (contract test for biome 2.x JSON shape), `.knip.json`.
- **Modified files**: `package.json` (+`knip` devDep, new/revised `hygiene*` scripts), `scripts/verify/_preconditions.sh` (+helpers), `CLAUDE.md` (workflow docs), `openspec/changes/add-diff-scoped-hygiene-cleanup/` (archive without credit), `openspec/changes/add-ts-static-analysis/` (archive without credit).
- **Dependencies**: root devDependencies gains `knip@^6`; no fallow install, no `remove-unused-vars`, no `tsr`. `typescript` (existing devDep) is reused by the home-roll deleter.
- **APIs / invocation surface**: new bun scripts `hygiene`, `hygiene --apply`, `hygiene --all`, `hygiene --apply --all`; bash entrypoint `bash scripts/hygiene/run.sh` with `--mode`, `--scope`, `--base`, `--iterations` flags; `HYGIENE_BASE_REF` env var.
- **Orthogonal, not affected**: `add-rust-dep-hygiene` (cargo-machete) remains in-flight and valid — Rust dep hygiene is out of scope for this change. All existing `verify:*` tiers are untouched and remain read-only. CI workflow (`.github/workflows/ci.yaml`) is NOT modified by this change; end-of-work-only is explicit.
- **Known uncovered edge** (accepted): unused non-private class members. Biome covers private; knip v6 removed the `classMembers` issue type. Revisit if it becomes a pain point.
