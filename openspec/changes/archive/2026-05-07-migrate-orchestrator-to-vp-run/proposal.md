## Why

The repository's task orchestration is currently spread across `bun run` and `bun run --filter` invocations with no content-addressed task caching, no shared CLI surface, and no unified task-graph derivation. VoidZero's Vite+ (`vp` CLI) reached alpha with bun support landed, providing a unified orchestrator surface (`vp run`) backed by Vite Task with dependency-aware execution and content-addressed caching. This change rebinds the task-graph orchestrator from `bun run` to `vp run` while keeping every underlying tool (biome, tsdown, bun test, cargo + napi-cli) in its current role — outer-dispatch swap with inner-tools intact, the lowest-blast-radius slice of the broader Vite+ adoption.

## What Changes

- **Install `vite-plus`** as a root devDependency at its current alpha version
- **Add `vite.config.ts`** at repository root defining the task graph that mirrors current dependency-derived ordering for verify, build, test, lint, and hygiene tiers
- **Migrate root `package.json` `scripts` block** — every migrated `verify:*`, `build:*`, and `hygiene` entry is **deleted** from root `package.json` scripts. `vp run <task>` becomes the only canonical dispatch surface for migrated tasks (hard cutover; no `bun run X` alias preserved). Tier scripts at `scripts/verify/*.sh` remain unchanged and are wrapped as task bodies via vp config. Vite+ docs require each task name to live in either `vite.config.ts` `run.tasks` OR `package.json` `scripts` but not both — this constraint enforces the hard cutover.
- **Migrate `.github/workflows/ci.yaml`** — install vite-plus in the CI environment, replace `bun run` invocations with `vp run` in every job step that runs a tier
- **Update root `CLAUDE.md`** — `Verification Tiers → Atomic Tiers` table `Command` column entries change from `bun run X` to `vp run X`; `Change-Type Map` `Run` column entries change in the same edit
- **Tier scripts unchanged** — `scripts/verify/*.sh` continue to be the loud-fail-precondition implementations; `_preconditions.sh` semantics preserved; vp config invokes `bash scripts/verify/<tier>.sh` as task body for any precondition-bearing tier
- **No tool changes outside orchestrator dispatch** — biome, tsdown, bun test, cargo, `@napi-rs/cli` all keep their current roles. Lint/format, library bundling, test runner, Rust pipeline rebinds are explicitly OUT OF SCOPE and reserved for separate follow-on changes
- **Bun retains package-manager identity** — `bun install`, `bun.lockb`, workspace topology, `.tool-versions` pin all unchanged

This is **NOT BREAKING for consumers** of `@animus-ui/*` packages — only the repository's internal task-dispatch surface changes. It IS breaking for any developer or CI environment that invokes `bun run <migrated-tier>` directly: post-migration, `bun run X` for any migrated tier name returns "script not found" (the entry no longer exists in `package.json`). All callers must use `vp run <tier>`. Per-package script aliases (e.g., `packages/system/package.json` `"build": "bun run build:ts"`) are PER-PACKAGE scope and are NOT affected. Unmigrated root scripts (`clean`, `clean:light`, `clean:full`, `dev:showcase`, `test`, `release`, biome wrappers `lint`/`format`/`check`/`check:fix`, `compile:tsc-fallback`) keep their `bun run` invocation surface.

## Capabilities

### New Capabilities

(none — this change rebinds existing surfaces; architectural invariants are already established in `verification-tier-policy`)

### Modified Capabilities

- `verification-tier-policy`: Atomic-tier table `Command` column references change from `bun run X` to `vp run X`. Composite-orchestrator references update similarly. All loud-fail / precondition / dist-staleness / atomic-tier-isolation contracts preserved verbatim. Atomic tiers DO NOT use vp's `dependsOn` (which auto-executes upstream tasks) — they retain the shell `_preconditions.sh` `require_*` fail-loud contract; only composite orchestrators use `dependsOn`. `_preconditions.sh` ROOT-script fix-command messages migrate from `bun run X` to `vp run X`; `bun run --filter '@animus-ui/<pkg>' build:ts` per-package fix-commands are unchanged (filter dispatch is not migrated).
- `workspace-build-ordering`: Cross-workspace dispatch references change from `bun run --filter` to vp's task-graph dispatch. Dependency-derived ordering invariant preserved — adding a package via `package.json` dependencies continues to position correctly without root config edits.
- `build-orchestration`: Build DAG / clean / verification-pipeline invocation references change. DAG semantics, clean coverage, and verification composition preserved. Rust NAPI step continues to invoke `cargo` / `napi build` (orchestrator shells out per Rust-pipeline exclusion).
- `bun-workspace`: `Bun workspace script execution` requirement scope tightens to "Bun is the package manager and workspace resolver"; cross-workspace task dispatch is now owned by `vp run`. `No competing orchestration tools` requirement updates — vp is now the singular orchestrator (alongside bun-as-PM).
- `code-hygiene`: `bun run hygiene` invocation surface migrates to `vp run hygiene` (or stays as `bash scripts/hygiene/run.sh` invoked as a vp task body). Cascade structure (Layers A/B/C/D), end-of-work-only contract (never appears in `.github/workflows/*.yaml`), safety envelope, and recovery-snapshot semantics preserved verbatim.

## Impact

- **Code**: new `vite.config.ts` at repo root; `package.json` `scripts` block migration; `.github/workflows/ci.yaml` migration; root `CLAUDE.md` tier table + Change-Type Map updates
- **Dependencies**: `vite-plus` added as root devDependency at pinned alpha version
- **CI**: vite-plus install step added to relevant jobs; `bun run` → `vp run` in every tier-invoking step
- **Out of scope** (reserved for separate follow-on changes): biome → oxlint via `vp check`, tsdown → `vp pack` (Rolldown), bun test → `vp test` (Vitest), cleaning surface verification (`vp cache` existence and scope), `vp env` interaction with `.tool-versions`
- **Permanent exclusion**: Rust NAPI build (`cargo` + `@napi-rs/cli`) and Rust unit tests (`cargo test`) are never owned by the orchestrator regardless of which orchestrator is bound. vp may orchestrate tier invocations that shell out to cargo, but cargo remains the toolchain.
- **No `packages/*` or `e2e/*` source changes** — only repository-root infrastructure

## Risk Acceptance

Vite+ is currently alpha. This proposal is a pre-GA cutover and requires maintainer-signed risk acceptance per the dual-criteria Migration Trigger contract.

**Specific exposure for this slice (orchestrator rebind only):**

- **Task-graph derivation divergence**: vp's dependency resolution may differ from bun's `--filter` topological behavior in edge cases. Mitigation: composite tasks in `vite.config.ts` declare `dependsOn` arrays explicitly (vp auto-executes upstream tasks per `dependsOn`); atomic tasks DO NOT use `dependsOn` and instead rely on shell `_preconditions.sh` to fail loud if upstream artifacts are missing or stale (preserving the "atomic tier never silently rebuilds" invariant). Verification: smoke-test full `vp run verify` and `vp run build:all` on a clean checkout before merge.
- **CI install-action stability**: vite-plus installation in CI may fail or behave differently across runs at alpha maturity. Mitigation: pin to a specific alpha version in `package.json`; avoid `latest` resolution.
- **Loud-fail message preservation**: vp's task dispatch wrapping must not swallow stderr or alter exit codes from the wrapped `bash scripts/verify/<tier>.sh`. Mitigation: explicit falsification probes in `tasks.md` — induce a stale dist and a missing NAPI binary, confirm the exact `ERROR: ... Run: ...` shape surfaces and exit code is non-zero.
- **Rollback complexity**: if vite.config.ts proves insufficient and shell scripts need to be threaded back as the canonical surface, the rollback must be a single-PR diff. Mitigation: keep `scripts/verify/*.sh` and `scripts/hygiene/*.sh` unchanged in this slice — rollback is "remove vite-plus, revert package.json scripts, revert ci.yaml, revert CLAUDE.md tier table." Tier scripts themselves never need to be touched.
- **Bun version pin interaction**: vp's `vp env` subcommand "manages your runtime and package manager selection." `vp env` was empirically verified during PoC (session 92) to break tsdown's `unrun` config-loader resolution by injecting incompatible env vars. Mitigation: this slice **prohibits** `vp env` activation — `.tool-versions` remains the sole bun-version source of truth. The migration also addresses the `packageManager: bun@1.3.13` field that vp auto-adds to `package.json` (PoC carryover) — either removed entirely or synced to match `.tool-versions` (`bun@1.3.11`). Hard policy: `vp env use` SHALL NOT be invoked locally or in CI for this repo. Documented in `CLAUDE.md` as part of this migration.

**Maintainer signature**: Aaron (sole repo author / sole maintainer) accepts the alpha-status exposure described above for this specific slice. Acceptance is scoped to the orchestrator-dispatch rebind only — does NOT extend to subsequent vp-related cutovers (each requires its own risk acceptance per follow-on change).
