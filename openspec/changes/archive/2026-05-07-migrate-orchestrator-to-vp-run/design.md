## Context

The animus monorepo currently dispatches all repository-root tasks (verify tiers, build commands, hygiene, test) via `bun run` and `bun run --filter`. There is no content-addressed task caching, no shared task-graph derivation across tier types, and no way to add a new task that automatically discovers its workspace-internal dependencies. The atomic-tier loud-fail-precondition contract is implemented in 14 shell scripts under `scripts/verify/` backed by the shared `scripts/verify/_preconditions.sh` helper — this is load-bearing and MUST be preserved verbatim through any orchestrator rebind.

VoidZero's Vite+ (`vp` CLI, https://viteplus.dev) reached alpha and now lists bun among its supported package managers (verified against the Vite+ landing page in this change's drafting session). This proposal executes the FIRST cutover slice of the broader Vite+ adoption: rebind the task-graph orchestrator from `bun run` to `vp run` while keeping every underlying tool unchanged. Lint/format/typecheck remain on biome; library bundling remains on tsdown; test runner remains on `bun test`; Rust pipeline remains on cargo + `@napi-rs/cli`. Each of those rebinds is reserved for its own follow-on change with its own per-slice risk acceptance.

Stakeholders: Aaron (sole repo author / sole maintainer). Pre-GA cutover requires maintainer-signed risk acceptance per the Migration Trigger Criteria contract — this is documented in `proposal.md`'s `## Risk Acceptance` section.

## Goals / Non-Goals

**Goals:**

- Rebind the canonical orchestrator-dispatch surface from `bun run X` to `vp run X` for all tier-related scripts at the repository root (verify, build, hygiene composites and atomics). `test`, biome wrappers (`lint`/`format`/`check`/`check:fix`), `clean*`, `release`, `dev:showcase`, and `compile:tsc-fallback` are NOT migrated and keep their current invocation surface.
- Establish a single source of truth for migrated tasks: each migrated task name lives in `vite.config.ts` `run.tasks` ONLY and is **deleted** from root `package.json` scripts (per Vite+ docs constraint that a task name may live in one or the other but not both). `vp run X` becomes the only invocation path; `bun run X` for migrated names returns "script not found" — hard cutover is the design.
- Add `vite-plus` as a root devDependency at a specific stable version (no `latest`).
- Author `vite.config.ts` with a task graph that mirrors current dependency-derived ordering and uses existing `bash scripts/verify/<tier>.sh` invocations as task bodies for every precondition-bearing tier.
- Update `.github/workflows/ci.yaml` to install vite-plus and dispatch tier work via `vp run`.
- Update root `CLAUDE.md` `Verification Tiers` table `Command` column AND `Change-Type Map` `Run` column to reflect `vp run` as the canonical surface.
- Preserve every existing invariant: atomic-tier loud-fail message shape (`ERROR: <X>. Run: <Y>`), atomic-tier isolation (no silent upstream rebuilds), `_preconditions.sh` semantics, dependency-derived build ordering, dist-staleness check pattern (existence AND mtime-vs-src), `.tool-versions` as authoritative bun-version pin, Change-Type Map authoritativeness.

**Non-Goals:**

- No biome → oxlint / `vp check` rebind. Lint/format/typecheck remain on biome under existing tier scripts.
- No tsdown → `vp pack` rebind. Library bundling remains on tsdown.
- No `bun test` → `vp test` (Vitest) rebind. Test runner stays on bun test.
- No Rust pipeline changes. `cargo` + `@napi-rs/cli` keep ownership; `cargo test` keeps ownership of unit tests; vp does NOT enter Rust toolchain territory.
- No `vp cache` binding for the cleaning surface. The `clean` command stays as `rm -rf` shells. Cleaning-surface verification is reserved for a separate follow-on (`resolve-clean-surface`).
- No `vp env` adoption. `.tool-versions` remains the sole bun-version source of truth in this slice.
- No tier-script rewrites. `scripts/verify/*.sh` and `scripts/hygiene/*.sh` are unchanged byte-for-byte.
- No spec-level invariant changes. Atomic-tier loud-fail contract, dist-staleness pattern, dependency-derived ordering — all preserved verbatim.

## Decisions

**D1: vite.config.ts wraps existing tier scripts; does not reimplement preconditions in vp-native config.**

The `_preconditions.sh` helper at `scripts/verify/_preconditions.sh` is load-bearing semantic — a single authoritative implementation of every atomic-tier precondition. Reimplementing precondition logic in vp-native config would require reproducing 14 tier scripts' logic in TypeScript, drifting two implementations, and risking divergence on edge cases (mtime resolution, key-artifact probing, dependency-derived freshness). Instead, vite.config.ts declares each tier as a task whose body invokes the existing shell script. Worst-case rollback is "remove vite.config.ts" — tier scripts work unchanged via direct bash invocation.

Alternative considered: rewrite tier scripts as TS task functions in vite.config.ts. Rejected because (a) doubles the maintenance surface, (b) drifts the loud-fail message shape from its established `ERROR: ... Run: ...` contract, (c) blocks rollback to bash if vp instability surfaces.

**D2: Hard cutover — migrated tasks are deleted from `package.json` scripts; `vp run` is the only invocation surface.**

Vite+ documentation states that "a task name can come from `vite.config.ts` or `package.json`, but not both." Defining the same name in both is undefined-behavior territory (resolution order is unspecified; risk of infinite-loop if package.json's `vp run X` recurses through vp's package.json fallback). To eliminate this ambiguity AND align with the migration's DX motivation (single task runner, single source of truth), every migrated tier name is **removed** from root `package.json` scripts entirely. `vp run X` becomes the canonical and ONLY invocation path for migrated tasks. `bun run <migrated-name>` returns "script not found" post-cutover — by design.

**Caller-surface impact (mechanical, batch-replaceable):** `_preconditions.sh` ROOT-script fix-command messages migrate from `Run: bun run build:extract` to `Run: vp run build:extract` (per-package `--filter` messages stay unchanged). `assert-{showcase,vite,next}.sh` `require_dir` fix-command args migrate similarly. `hygiene/run.sh` lines 435 + 438 (safety envelope) migrate from `bun run verify:compile|verify:lint` to `vp run verify:compile|verify:lint`. `.github/workflows/ci.yaml` `bun run <migrated-name>` invocations migrate to `vp run <name>` (`bun run check` stays — `check` is unmigrated). Root + per-package `CLAUDE.md` doc references migrate via batch grep.

Alternative considered (rejected): keep `bun run X` as transparent alias by declaring `"X": "vp run X"` in package.json AND defining `X` in `vite.config.ts` `run.tasks`. Rejected because (a) violates the docs' "not both" pattern with unspecified resolution order, (b) maintains two parallel dispatch surfaces in perpetuity (every new tier requires synchronized package.json + vite.config.ts entries), (c) anti-aligned with the DX-simplification motivation that justified this migration.

Alternative considered (rejected): keep `bun run X` working by changing `"X"` in package.json to `bash scripts/...`-direct (skipping vp). Rejected because (a) creates a "bun bypasses vp" surface that loses caching/orchestration when invoked via bun, (b) silently diverges behavior depending on which dispatch path the caller used, (c) future vp slices (test, lint, fmt) would compound the dual-dispatch maintenance burden.

**Accepted impact:** muscle-memory hit on `bun run <migrated>` for the maintainer. Mitigation is shell-side aliasing if desired (user-owned, not in this change's scope).

**D3: Vite-plus version is pinned, not floating.**

`vite-plus` is added at a specific alpha version pinned in `package.json` `devDependencies`. CI install action references the same pinned version. No `^`-range or `latest` resolution. Alpha-status implies higher likelihood of breaking changes between releases; pinning eliminates surprise CI breakage from upstream churn.

Version selection: pin to whatever the latest stable alpha is at implementation time. Record the version in this design.md addendum (or in a tasks.md note) before merge.

**D4: Composite tasks declare `dependsOn` explicitly; atomic tasks DO NOT use `dependsOn`.**

Vite+ docs confirm that `dependsOn` AUTO-EXECUTES upstream tasks before the requested task: _"Tasks that must complete successfully before this one starts"_ — running `vp run X` with `dependsOn: ['Y']` runs Y first, then X. This is the desired behavior for composite orchestrators (`verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`, `verify:vite`) which today chain atomic tiers via `&&`; under vp they declare `dependsOn` arrays and vp executes them in order.

For atomic tiers, however, `dependsOn` is the WRONG tool. The `verification-tier-policy` capability mandates that "atomic tier never silently rebuilds upstream" — a fail-loud `ERROR: <X> missing. Run: <Y>` message is the contract on stale/missing upstream artifacts, NOT auto-rebuild. If atomic tiers used `dependsOn`, vp would silently auto-build the upstream — violating the spec invariant that the user fixed by hand-running the named command. Therefore: **atomic tasks omit `dependsOn` entirely**. Their task body invokes `bash scripts/verify/<tier>.sh`, and the shell script's existing `_preconditions.sh` `require_*` calls fail loud per spec on missing/stale upstream artifacts. The verification-tier-policy invariant is preserved by intentionally NOT using vp's dependency feature where it would conflict with our fail-loud contract.

This split — `dependsOn` for composites, shell-preconditions for atomics — is the load-bearing modeling decision of this slice. D6 falsification probes verify both behaviors empirically.

**D5: CLAUDE.md tier table and Change-Type Map updated atomically with the code cutover.**

Per the existing `verification-tier-policy` Change-Type Map invariant, the map's `Run` column is the authoritative agent-facing instructability surface. When tier invocation surfaces change (`bun run X` → `vp run X`), the map MUST update in the same change. This proposal does that update inline; no follow-on is required.

**D6: Atomic-tier loud-fail contract verified via explicit falsification probes.**

The risk that vp's task wrapping might swallow stderr or alter exit codes from wrapped shell scripts is real. To validate, `tasks.md` includes explicit falsification probes — induce a stale dist, induce a missing NAPI binary, run `vp run verify:integration` / `vp run verify:canary`, confirm the exact `ERROR: <X>. Run: <Y>` shape surfaces on stderr and exit code is non-zero. Additionally: probe that `vp run` does NOT silently rebuild upstream when atomic-tier task body's preconditions fail (`packages/extract/dist/` MUST stay absent after a precondition-failed run), and probe that `bun run <migrated-name>` after cutover returns "script not found" (NOT a successful invocation through some fallback path). The probes are the proof that the loud-fail contract AND the hard cutover survived the rebind.

**D7: Rollback is a single-PR diff.**

If anything misbehaves post-cutover, rollback is mechanical: (a) delete `vite.config.ts` (created at root by this change), (b) restore migrated tier entries to root `package.json` scripts (re-add the deleted `verify:*`, `build:*`, `hygiene` entries pointing back at `bash scripts/verify/<tier>.sh` or appropriate direct invocations), (c) revert `.github/workflows/ci.yaml` (`vp run X` → `bun run X` for migrated names; `bun run check` was unchanged), (d) revert root `CLAUDE.md` tier table + Change-Type Map sections, (e) revert `_preconditions.sh` ROOT-script fix-command messages (`vp run` → `bun run`), (f) revert `assert-{showcase,vite,next}.sh` `require_dir` fix-command args, (g) revert `hygiene/run.sh` lines 435 + 438, (h) revert per-package + hygiene `CLAUDE.md` doc-references, (i) `bun remove vite-plus`. Tier shell scripts under `scripts/verify/*.sh` (other than the precondition fix-command message edits) and `scripts/hygiene/*.sh` are NOT touched structurally, so they don't need execution-flow rollback.

## Risks / Trade-offs

- **[vp's task-graph derivation may diverge from bun's `--filter` topological behavior]** → Mitigated by D4 (explicit task dependencies in vite.config.ts). Verification: smoke-test `vp run build:all` with full DAG and confirm same package build order as `bun run build:all`.

- **[CI install-action stability under alpha-version vite-plus]** → Mitigated by D3 (pinned version). Additional mitigation: include vite-plus install in CI as a discrete step that fails loud if install fails, before any tier dispatch.

- **[vp's task wrapping may swallow stderr or alter exit codes from `bash scripts/verify/<tier>.sh`]** → Mitigated by D6 (explicit falsification probes). If probes fail, revert per D7 and surface the bug upstream to VoidZero.

- **[vite.config.ts API may shift across alpha releases]** → Mitigated by D3 (pinned version). If a future vp release breaks this config, the rebind follow-on (`migrate-build-to-vp-pack` or future) updates pin + config in lockstep.

- **[Loss of `bun run <migrated>` muscle memory]** → ACCEPTED tradeoff per D2 (NOT mitigated; this is the design). Single source of truth in `vite.config.ts` is the goal; muscle-memory loss is the cost. Maintainer-side mitigation via shell aliases (e.g., `alias vrun='vp run'`) is user-owned and out-of-scope. Unmigrated invocations (`bun run clean:light`, `bun run check`, `bun run test`, `bun run dev:showcase`, etc.) keep working because their package.json entries remain.

- **[Task-graph parity with `bun run --filter` for cross-workspace dispatch]** → Mitigated by smoke-testing `vp run --filter` (or vp's equivalent) against the package set and confirming filter resolution matches bun's behavior. If parity gaps surface, vite.config.ts can declare per-package tasks explicitly instead of relying on filter inference.

- **[Hygiene cascade dispatched via vp may interact with `_preconditions.sh` in an unexpected way]** → Mitigated by D1 (vp invokes `bash scripts/hygiene/run.sh` as task body unchanged). If issues surface, hygiene can stay on direct bash invocation in this slice and migrate to vp dispatch in a separate hygiene-specific follow-on.

## Migration Plan

1. **Install vite-plus + author vite.config.ts.** Pin version. Author config with task graph mirroring current dependency-derived ordering. Each tier task body = `bash scripts/verify/<tier>.sh` (or hygiene/build equivalent).

2. **Delete migrated tier entries from root `package.json` scripts.** Every migrated tier name (atomic verify:_ tiers + verify composites + build:_ + hygiene) is removed from root `package.json` scripts entirely. Unmigrated entries stay (`clean*` shells, `dev:showcase`, `test` bun-test alias, biome wrappers `lint`/`format`/`check`/`check:fix`, `release`, `compile:tsc-fallback`, `compile` workspace-filter alias, `deploy:showcase`, `rebuild`). After the migration, root `package.json` scripts shrinks from 41 entries to ~15.

3. **Smoke test locally.** `bun install`. `bun run verify` (which now routes via vp). Confirm: all atomic tiers run in correct order; loud-fail messages still match `ERROR: ... Run: ...`; exit codes non-zero on failure; no silent upstream rebuilds.

4. **Falsification probes.** Induce stale dist (touch `packages/system/src/types/config.ts` post-build); run `vp run verify:integration`; confirm exact `ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts` shape on stderr + exit 1. Induce missing NAPI binary (`rm packages/extract/*.node`); run `vp run verify:canary`; confirm `ERROR: NAPI binary missing. Run: bun run build:extract` + exit 1.

5. **Migrate `.github/workflows/ci.yaml`.** Add vite-plus install step (pinned version) in every job that runs a tier. Replace `bun run X` invocations with `vp run X`. Validate workflow on a CI preview branch before merging to `next`.

6. **Update root `CLAUDE.md`.** `Verification Tiers → Atomic Tiers` table `Command` column entries: `bun run X` → `vp run X`. Same for composite orchestrators table. `Change-Type Map` `Run` column entries: `bun run X` → `vp run X`. Add a one-line note above the tables: "`vp run X` is the canonical and only invocation path for migrated tasks. `bun run` continues to work for unmigrated scripts (`clean*`, `dev:showcase`, `test`, biome wrappers, `release`, etc.)." Update `scripts/hygiene/CLAUDE.md` `Commands` table similarly. Update per-package `CLAUDE.md` references to migrated tasks.

7. **Final verification.** Full `vp run verify:full` on clean checkout. Confirm all tiers green, all loud-fail probes from step 4 still pass, CI preview run still green.

**Rollback path:** revert `vite.config.ts`, `package.json` `scripts`, `.github/workflows/ci.yaml`, and root `CLAUDE.md` tier table sections. `bun remove vite-plus`. Re-run `bun install`. All tier scripts under `scripts/verify/*.sh` and `scripts/hygiene/*.sh` are untouched, so they continue to work via direct bash invocation if anyone runs them. Single-PR rollback diff.

## Open Questions

- **vp config filename:** RESOLVED — `vite.config.ts` at repo root (shared filename with Vite's own config). Vp tasks live under top-level `run.tasks` key. This proposal does NOT touch the existing per-package `vite.config.ts` files at `packages/showcase/vite.config.ts` or `e2e/vite-app/vite.config.ts`; the orchestrator config goes at repo root only. Source: viteplus.dev/config/run.

- **vp's task-dispatch invocation pattern:** RESOLVED — `vp run <task>`. Source: viteplus.dev/guide/run.

- **vp's task-graph derivation source:** RESOLVED — explicit `dependsOn` arrays in `vite.config.ts` `run.tasks.<name>.dependsOn`. vp's `dependsOn` AUTO-EXECUTES upstream tasks per docs; D4 leverages this for composite orchestrators and intentionally omits `dependsOn` for atomic tiers (where auto-rebuild would violate the verification-tier-policy "atomic tier never silently rebuilds" invariant).

- **vp's stderr/exit-code preservation when wrapping shell scripts:** PENDING empirical verification via D6 probes during Phase 2 of `tasks.md`. Docs do not document the contract; foundation-slice smoke test is the gate.

- **vp's content-addressed cache configuration:** RESOLVED — vp v0.1.20 has a `cache: true` default per task, but cache stores stdout/stderr ONLY (NOT artifact files). For tasks where artifact-presence is the signal (build tasks emitting `dist/`), `cache: false` is the correct default to prevent cache hits on missing artifacts. Additionally, vp's auto-input detection sees only the shell script body for shell-wrapped tasks (not the source files the script transitively reads), so explicit `input` glob declarations are required for caching to be correct. Initial migration lands with `cache: false` everywhere — caching becomes a future optimization slice once correctness is proven.

- **vp install action for CI:** PENDING — defer to CI integration phase (Phase 4 in tasks.md). The `voidzero-dev/setup-vp@v1` action is the documented install path but may invoke `vp env use` internally, which would conflict with this slice's "vp env stays disabled" policy. If the action invokes `vp env`, bypass it: install via `curl -fsSL https://vite.plus | bash` with explicit version pinning, then `bun install` separately.

- **Hygiene tier dispatch via vp:** PENDING — verify via smoke run during hygiene migration step. If incompatible, hygiene stays on direct `bash scripts/hygiene/run.sh` invocation in this slice and migrates separately (downgrades the migration scope but doesn't block the verify-tier rebind).

- **`packageManager` field handling:** vp v0.1.20 auto-adds `"packageManager": "bun@1.3.13"` to root `package.json` (PoC carryover proves this). `.tool-versions` declares `bun 1.3.11` as authoritative. Either remove the `packageManager` field entirely (let `.tool-versions` be sole source) OR sync the version. This change resolves by **removing** the field — `.tool-versions` is the single source of truth per the existing `verification-tier-policy` Bun Version Pin requirement.
