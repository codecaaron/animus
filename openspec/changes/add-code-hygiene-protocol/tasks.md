## 1. Supersede prior in-flight changes

- [x] 1.1 Add supersession banner to top of `openspec/changes/add-diff-scoped-hygiene-cleanup/proposal.md`: `> **SUPERSEDED by add-code-hygiene-protocol — not implemented.** See `openspec/changes/add-code-hygiene-protocol/` for the authoritative design.`
- [x] 1.2 Archive `add-diff-scoped-hygiene-cleanup`: `openspec archive add-diff-scoped-hygiene-cleanup --skip-specs -y` (draft specs were never promoted; skip-specs prevents accidental promotion)
- [x] 1.3 Add identical supersession banner to top of `openspec/changes/add-ts-static-analysis/proposal.md`
- [x] 1.4 Archive `add-ts-static-analysis`: `openspec archive add-ts-static-analysis --skip-specs -y`
- [x] 1.5 Delete `.fallowrc.json` from repo root if present
- [x] 1.6 Remove `fallow` devDependency from root `package.json` if present
- [x] 1.7 Remove the following scripts from root `package.json` if present: `fallow:audit`, `verify:hygiene:ts`, `hygiene:preview`, `hygiene:apply` (will be re-added with new semantics in § 6)
- [x] 1.8 Remove `verify:hygiene:ts` invocation from the `verify:ci` composite script chain in root `package.json`
- [x] 1.9 Delete `scripts/verify/hygiene-ts.sh` if present
- [x] 1.10 Delete `scripts/hygiene/cleanup-diff.sh` if present (replaced by new `run.sh` in § 4)
- [x] 1.11 Remove `require_fallow_binary` and `require_hygiene_cleanup_deps` from `scripts/verify/_preconditions.sh` if present

## 2. Install and configure knip

- [x] 2.1 Install knip v6 as a root devDependency: `bun add --dev knip@^6`
- [x] 2.2 Verify install: `bunx --bun knip --version` exits 0 and reports `6.x.x`
- [x] 2.3 Create `.knip.json` at repo root with `$schema: "https://unpkg.com/knip@6/schema.json"`, minimal `entry` patterns for Animus's workspace topology, `ignore` patterns for `legacy/**` and `packages/showcase/src/content/**/*.mdx`, and `ignoreDependencies` for NAPI platform tarballs (`@napi-rs/*` variants and any other build-only packages)
- [x] 2.4 Calibrate `.knip.json` iteratively: run `bunx --bun knip --no-progress` baseline, inspect findings, add workspace overrides or ignore entries for known-live false positives, re-run until output contains only genuine unused findings
- [x] 2.5 Confirm knip's Biome / Next / Vite / tsdown / Bun plugins auto-enable against Animus's `package.json` deps without explicit opt-in; add explicit plugin config ONLY if auto-detect produces wrong defaults (plugin overrides REPLACE not merge, so avoid overriding unless necessary)

## 3. Home-roll deleter

- [x] 3.1 Create `scripts/hygiene/delete-unused.ts` (TypeScript, bun-runnable). No new devDep — uses existing `typescript`.
- [x] 3.2 Implement biome 2.x JSON parser: consume `--reporter=json` stdout, extract `diagnostics[]`, read `location.path: string`, `location.start.{line, column}: number`, `location.end.{line, column}: number`, and `category: string`
- [x] 3.3 Implement filter: keep diagnostics with `category === "correctness/noUnusedVariables"`; include `category === "correctness/noUnusedFunctionParameters"` ONLY when the reported location targets a `BindingElement` inside a destructuring pattern (positional param rename is out-of-scope)
- [x] 3.4 Implement line+column → character-offset conversion by scanning the source text (biome uses 1-indexed lines and 1-indexed columns)
- [x] 3.5 Implement AST walker using `ts.createSourceFile(path, source, ts.ScriptTarget.Latest, /* setParentNodes */ true)`; given an offset, descend to the narrowest containing node, then walk up to the first ancestor matching one of: `VariableStatement`, `FunctionDeclaration`, `ClassDeclaration`, `TypeAliasDeclaration`, `InterfaceDeclaration`, `EnumDeclaration`, `BindingElement`
- [x] 3.6 Handle multi-declarator `VariableStatement`: if one of several declarators is the dead one, remove just the matching `VariableDeclaration` node + its trailing comma, preserve the rest of the statement
- [x] 3.7 Handle `BindingElement` inside `ObjectBindingPattern` / `ArrayBindingPattern`: remove element + neighboring comma; preserve enclosing declaration
- [x] 3.8 Implement splice: sort all deletion ranges in reverse offset order, splice each out of the source string, write file back
- [x] 3.9 CLI interface: accept explicit file list as args (optional) and/or read biome JSON from stdin; default reads stdin pipe; exit 0 on success (even if no mutations), exit 1 on biome JSON parse error, exit 2 on internal error
- [x] 3.10 Create `scripts/hygiene/delete-unused.test.ts` with bun-test fixtures covering: unused `const`, unused `function`, unused `let`, unused `class`, unused `type`, unused `interface`, unused `enum`, destructured-field unused, multi-declarator `VariableStatement` with one dead, `BindingElement` comma-handling at start/middle/end positions
- [x] 3.11 Add an explicit assertion in the test that verifies biome 2.x JSON field names (`location.path` as string, `location.start.line`, etc.) — so a biome 3.x bump that renames fields fails this test loud, pointing the next maintainer at the one-file fix

## 4. Orchestrator script

- [x] 4.1 Create `scripts/hygiene/run.sh` with `#!/usr/bin/env bash` and `set -euo pipefail`
- [x] 4.2 Source `scripts/verify/_preconditions.sh` and invoke `require_code_hygiene_deps` at startup
- [x] 4.3 Parse CLI flags: `--mode=scan|fix`, `--scope=changed|all`, `--base=<ref>`, `--iterations=<n>`, `--apply` (alias sets `mode=fix`), `--all` (alias sets `scope=all`); honor `HYGIENE_BASE_REF` env var for base ref; defaults: `mode=scan`, `scope=changed`, `base=main`, `iterations=5`
- [x] 4.4 Implement file-set derivation: for `scope=changed` use `git diff --name-only "$BASE" -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs'`; for `scope=all` enumerate `packages/*/src/**` + `e2e/*/src/**` via find/rg
- [x] 4.5 Implement workspace derivation: for each changed file, walk up to nearest `package.json` with a `"name"` field; deduplicate; output as array of names
- [x] 4.6 Scan-mode guard: if `mode=scan` and `git status --porcelain` is non-empty, exit 1 with "ERROR: scan mode requires clean worktree. Commit or stash changes and re-run."
- [x] 4.7 Scan-mode snapshot: capture `SNAPSHOT_SHA=$(git stash create 2>/dev/null || echo "")` immediately before the cascade (works even on clean tree — returns empty if nothing to stash, still proceeds)
- [x] 4.8 Implement cascade loop up to `$ITERATIONS` iterations; each iteration runs layers A→B→C→D in order; after each pass check `git diff --quiet` (or equivalent) — exit loop early if no change
- [x] 4.9 Layer A invocation: `bunx --bun @biomejs/biome check --write <files>` (safe pass — no `--unsafe`)
- [x] 4.10 Layer B invocation: `bunx --bun @biomejs/biome check --write --unsafe --only=correctness/noUnusedImports --only=correctness/noUnusedPrivateClassMembers <files>` (verify empirically that biome accepts repeated `--only` flags; if it requires comma-separated form, adjust to `--only=correctness/noUnusedImports,correctness/noUnusedPrivateClassMembers`)
- [x] 4.11 Layer C invocation: `bunx --bun @biomejs/biome check --reporter=json <files> | bun run scripts/hygiene/delete-unused.ts` (piped mode; deleter reads biome JSON from stdin)
- [x] 4.12 Layer D invocation: for `scope=changed`, build workspace args via derivation from § 4.5, invoke `bunx --bun knip --fix --fix-type exports,types,dependencies,files --allow-remove-files --workspace <name>` (one `--workspace` per derived name); for `scope=all`, invoke without any `--workspace` flag
- [x] 4.13 Scan-mode report + restore: after the cascade loop, capture `git diff --stat` and `git diff --name-status` into a report block, then `git reset --hard HEAD && git clean -fd` to restore the worktree; print the report block and the snapshot SHA with recovery instructions
- [x] 4.14 Fix-mode safety envelope: after cascade, run `bun run verify:compile`; on failure, print output + `git status` + mutations list + three recovery options (hard reset, fix forward, partial-keep) and exit non-zero; if compile passes, run `bun run verify:lint`; same failure handling; do NOT auto-revert at any stage
- [x] 4.15 Emit a structured summary to stdout in both modes: iteration count, per-layer mutation counts (from `git diff` diffs between layers), final convergence status, envelope result (fix mode) or snapshot SHA (scan mode)

## 5. Precondition helpers

- [x] 5.1 Add `require_knip_binary` helper to `scripts/verify/_preconditions.sh`: `if ! bunx --bun knip --version >/dev/null 2>&1; then echo "ERROR: knip missing. Run: bun install" >&2; return 1; fi`
- [x] 5.2 Add `require_typescript` helper: checks `node_modules/typescript/bin/tsc` is executable; error: "ERROR: typescript missing. Run: bun install"
- [x] 5.3 Add `require_code_hygiene_deps` composite helper: `require_biome || return 1; require_knip_binary || return 1; require_typescript || return 1`
- [x] 5.4 Confirm that the existing `require_biome` helper (added in prior arc) is unchanged and reused; do NOT reimplement
- [x] 5.5 Add header-comment block documenting the new helpers follow the established `require_*` naming and `ERROR: X. Run: Y` message shape

## 6. Package.json wiring

- [ ] 6.1 Add `"hygiene": "bash scripts/hygiene/run.sh"` to root `package.json` `scripts`
- [ ] 6.2 Verify `bun run hygiene --apply --all` correctly forwards flags through to the bash script (bun passes unknown trailing args to the underlying script by default; if not, adjust the wrapper to `"hygiene": "bash scripts/hygiene/run.sh \"$@\""` or equivalent)
- [ ] 6.3 Confirm `knip@^6` is the only new devDep; no `remove-unused-vars`, no `tsr`, no `fallow`, no `ts-morph`
- [ ] 6.4 Run `bun install` to update lockfile; commit `bun.lock` in the same commit as `package.json`

## 7. Documentation surface

- [ ] 7.1 Replace the existing `### Hygiene Workflow` section in root `CLAUDE.md` with a section describing: the new `bun run hygiene` entrypoint, flag semantics, default behaviors, safety envelope (no auto-revert), snapshot SHA recovery, and the explicit end-of-work-only contract (no CI invocation)
- [ ] 7.2 Remove every `verify:hygiene:ts` reference from `CLAUDE.md` (atomic-tiers table, composite-orchestrators table, change-type map, hygiene-workflow section)
- [ ] 7.3 Remove every fallow / `.fallowrc.json` reference from `CLAUDE.md`
- [ ] 7.4 Add new rows to the Change-Type Map in `CLAUDE.md`: `.knip.json` → `bun run hygiene`; `scripts/hygiene/**` → `bun run hygiene` + `bun test scripts/hygiene/delete-unused.test.ts`
- [ ] 7.5 Remove any cross-references to the prior arc's `openspec/specs/hygiene-cleanup/spec.md` or `openspec/specs/ts-static-analysis/spec.md` (neither file exists; any references are stale)

## 8. Smoke and finalize

- [x] 8.1 Smoke-test scan mode on a clean checkout: `bun run hygiene` produces a readable report; `git status --porcelain` is empty after exit; snapshot SHA is printed
- [x] 8.2 Smoke-test fix mode: deliberately introduce a dead `const`, an unused named import, and an unused cross-file export; run `bun run hygiene --apply`; verify cascade converges, envelope passes, and only the introduced dead artifacts are removed (no collateral changes)
- [ ] 8.3 Smoke-test `scope=all`: `bun run hygiene --all` and `bun run hygiene --apply --all` scope correctly; note any surprises in the calibration baseline for follow-on tuning
- [x] 8.4 Smoke-test envelope-failure path: introduce a compile error that would survive the cascade (e.g., reference to a symbol that will be deleted); run `bun run hygiene --apply`; verify orchestrator reports the failure, prints recovery options, exits non-zero, and does NOT revert the mutations
- [x] 8.5 Run `bun run verify:full` to confirm no regressions introduced by the archival removals, new scripts, or new devDep
- [x] 8.6 Run `openspec validate add-code-hygiene-protocol --strict` and confirm passes
- [ ] 8.7 Archive this change: `openspec archive add-code-hygiene-protocol -y` — promotes `code-hygiene` spec from this change's `specs/` to authoritative `openspec/specs/code-hygiene/spec.md`
