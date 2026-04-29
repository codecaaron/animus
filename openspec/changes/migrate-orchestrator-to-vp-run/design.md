## Context

The animus monorepo currently dispatches all repository-root tasks (verify tiers, build commands, hygiene, test) via `bun run` and `bun run --filter`. There is no content-addressed task caching, no shared task-graph derivation across tier types, and no way to add a new task that automatically discovers its workspace-internal dependencies. The atomic-tier loud-fail-precondition contract is implemented in 14 shell scripts under `scripts/verify/` backed by the shared `scripts/verify/_preconditions.sh` helper — this is load-bearing and MUST be preserved verbatim through any orchestrator rebind.

VoidZero's Vite+ (`vp` CLI, https://viteplus.dev) reached alpha and now lists bun among its supported package managers (verified against the Vite+ landing page in this change's drafting session). This proposal executes the FIRST cutover slice of the broader Vite+ adoption: rebind the task-graph orchestrator from `bun run` to `vp run` while keeping every underlying tool unchanged. Lint/format/typecheck remain on biome; library bundling remains on tsdown; test runner remains on `bun test`; Rust pipeline remains on cargo + `@napi-rs/cli`. Each of those rebinds is reserved for its own follow-on change with its own per-slice risk acceptance.

Stakeholders: Aaron (sole repo author / sole maintainer). Pre-GA cutover requires maintainer-signed risk acceptance per the Migration Trigger Criteria contract — this is documented in `proposal.md`'s `## Risk Acceptance` section.

## Goals / Non-Goals

**Goals:**

- Rebind the canonical orchestrator-dispatch surface from `bun run X` to `vp run X` for all tier-related scripts at the repository root (verify, build, test, lint, hygiene composites and atomics).
- Preserve `bun run X` as a transparent alias path during and after the cutover (`package.json` `"X": "vp run X"` keeps the bun-side invocation working).
- Add `vite-plus` as a root devDependency at a specific alpha version (no `latest`).
- Author `vp.config.ts` with a task graph that mirrors current dependency-derived ordering and uses existing `bash scripts/verify/<tier>.sh` invocations as task bodies for every precondition-bearing tier.
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

**D1: vp.config.ts wraps existing tier scripts; does not reimplement preconditions in vp-native config.**

The `_preconditions.sh` helper at `scripts/verify/_preconditions.sh` is load-bearing semantic — a single authoritative implementation of every atomic-tier precondition. Reimplementing precondition logic in vp-native config would require reproducing 14 tier scripts' logic in TypeScript, drifting two implementations, and risking divergence on edge cases (mtime resolution, key-artifact probing, dependency-derived freshness). Instead, vp.config.ts declares each tier as a task whose body invokes the existing shell script. Worst-case rollback is "remove vp.config.ts" — tier scripts work unchanged via direct bash invocation.

Alternative considered: rewrite tier scripts as TS task functions in vp.config.ts. Rejected because (a) doubles the maintenance surface, (b) drifts the loud-fail message shape from its established `ERROR: ... Run: ...` contract, (c) blocks rollback to bash if vp instability surfaces.

**D2: `package.json` scripts route through `vp run`, preserving bun-side aliases.**

Every tier-related root script in `package.json` becomes `"<name>": "vp run <name>"`. This makes `vp run X` the canonical orchestrator surface while keeping `bun run X` working transparently — `bun run verify` invokes `package.json` `verify`, which invokes `vp run verify`, which dispatches the vp task. Preserves backward compatibility for any developer muscle memory and any existing CI step using bun run.

Alternative considered: replace `bun run X` entirely with direct `vp run X` invocations everywhere (no aliases). Rejected because (a) breaks any developer's existing muscle memory mid-cutover, (b) creates more diff surface in CI workflow, (c) loses the transparent-alias safety affordance.

**D3: Vite-plus version is pinned, not floating.**

`vite-plus` is added at a specific alpha version pinned in `package.json` `devDependencies`. CI install action references the same pinned version. No `^`-range or `latest` resolution. Alpha-status implies higher likelihood of breaking changes between releases; pinning eliminates surprise CI breakage from upstream churn.

Version selection: pin to whatever the latest stable alpha is at implementation time. Record the version in this design.md addendum (or in a tasks.md note) before merge.

**D4: vp config defines task dependencies explicitly, not via package.json-script derivation.**

vp's `vite-task` may support deriving task DAGs from package.json `scripts` ordering or from workspace `dependencies`. The exact derivation behavior is currently unverified. To avoid implicit-behavior risk, vp.config.ts declares each task's dependencies explicitly (e.g., `verify:build:next` depends on `verify:build:extract` and `verify:build:ts`). This makes the task graph reviewable as TS code rather than inferred from elsewhere.

**D5: CLAUDE.md tier table and Change-Type Map updated atomically with the code cutover.**

Per the existing `verification-tier-policy` Change-Type Map invariant, the map's `Run` column is the authoritative agent-facing instructability surface. When tier invocation surfaces change (`bun run X` → `vp run X`), the map MUST update in the same change. This proposal does that update inline; no follow-on is required.

**D6: Atomic-tier loud-fail contract verified via explicit falsification probes.**

The risk that vp's task wrapping might swallow stderr or alter exit codes from wrapped shell scripts is real. To validate, `tasks.md` includes explicit falsification probes — induce a stale dist, induce a missing NAPI binary, run `vp run verify:integration` / `vp run verify:canary`, confirm the exact `ERROR: <X>. Run: <Y>` shape surfaces on stderr and exit code is non-zero. The probes are the proof that the loud-fail contract survived the rebind.

**D7: Rollback is a single-PR diff (4 files + dependency removal).**

If anything misbehaves post-cutover, rollback is mechanical: (a) revert `vp.config.ts` (delete or empty), (b) revert `package.json` `scripts` block, (c) revert `.github/workflows/ci.yaml`, (d) revert root `CLAUDE.md` tier table + Change-Type Map sections, (e) `bun remove vite-plus`. Tier scripts under `scripts/verify/*.sh` and `scripts/hygiene/*.sh` are NOT touched in this cutover, so they don't need any rollback consideration.

## Risks / Trade-offs

- **[vp's task-graph derivation may diverge from bun's `--filter` topological behavior]** → Mitigated by D4 (explicit task dependencies in vp.config.ts). Verification: smoke-test `vp run build:all` with full DAG and confirm same package build order as `bun run build:all`.

- **[CI install-action stability under alpha-version vite-plus]** → Mitigated by D3 (pinned version). Additional mitigation: include vite-plus install in CI as a discrete step that fails loud if install fails, before any tier dispatch.

- **[vp's task wrapping may swallow stderr or alter exit codes from `bash scripts/verify/<tier>.sh`]** → Mitigated by D6 (explicit falsification probes). If probes fail, revert per D7 and surface the bug upstream to VoidZero.

- **[vp.config.ts API may shift across alpha releases]** → Mitigated by D3 (pinned version). If a future vp release breaks this config, the rebind follow-on (`migrate-build-to-vp-pack` or future) updates pin + config in lockstep.

- **[Loss of `bun run X` familiarity if developers conflate vp and bun]** → Mitigated by D2 (alias preservation). Developers can continue using `bun run X` indefinitely; the migration is invisible to muscle memory.

- **[Task-graph parity with `bun run --filter` for cross-workspace dispatch]** → Mitigated by smoke-testing `vp run --filter` (or vp's equivalent) against the package set and confirming filter resolution matches bun's behavior. If parity gaps surface, vp.config.ts can declare per-package tasks explicitly instead of relying on filter inference.

- **[Hygiene cascade dispatched via vp may interact with `_preconditions.sh` in an unexpected way]** → Mitigated by D1 (vp invokes `bash scripts/hygiene/run.sh` as task body unchanged). If issues surface, hygiene can stay on direct bash invocation in this slice and migrate to vp dispatch in a separate hygiene-specific follow-on.

## Migration Plan

1. **Install vite-plus + author vp.config.ts.** Pin version. Author config with task graph mirroring current dependency-derived ordering. Each tier task body = `bash scripts/verify/<tier>.sh` (or hygiene/build equivalent).

2. **Migrate `package.json` scripts.** Replace `"<tier>": "bash scripts/verify/<tier>.sh"` with `"<tier>": "vp run <tier>"` for every atomic tier and composite. Same for `build:*`, `test`, `hygiene`, `lint*`, `format*` where applicable. Preserve `clean*` as direct shell (no vp dispatch needed for cleaning in this slice).

3. **Smoke test locally.** `bun install`. `bun run verify` (which now routes via vp). Confirm: all atomic tiers run in correct order; loud-fail messages still match `ERROR: ... Run: ...`; exit codes non-zero on failure; no silent upstream rebuilds.

4. **Falsification probes.** Induce stale dist (touch `packages/system/src/types/config.ts` post-build); run `vp run verify:integration`; confirm exact `ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts` shape on stderr + exit 1. Induce missing NAPI binary (`rm packages/extract/*.node`); run `vp run verify:canary`; confirm `ERROR: NAPI binary missing. Run: bun run build:extract` + exit 1.

5. **Migrate `.github/workflows/ci.yaml`.** Add vite-plus install step (pinned version) in every job that runs a tier. Replace `bun run X` invocations with `vp run X`. Validate workflow on a CI preview branch before merging to `next`.

6. **Update root `CLAUDE.md`.** `Verification Tiers → Atomic Tiers` table `Command` column entries: `bun run X` → `vp run X`. Same for composite orchestrators table. `Change-Type Map` `Run` column entries: `bun run X` → `vp run X`. Add a one-line note above the tables: "`bun run X` continues to work as a transparent alias for `vp run X`; `vp run` is canonical."

7. **Final verification.** Full `vp run verify:full` on clean checkout. Confirm all tiers green, all loud-fail probes from step 4 still pass, CI preview run still green.

**Rollback path:** revert `vp.config.ts`, `package.json` `scripts`, `.github/workflows/ci.yaml`, and root `CLAUDE.md` tier table sections. `bun remove vite-plus`. Re-run `bun install`. All tier scripts under `scripts/verify/*.sh` and `scripts/hygiene/*.sh` are untouched, so they continue to work via direct bash invocation if anyone runs them. Single-PR rollback diff.

## Open Questions

- **vp config filename:** Is it `vp.config.ts`? `vite.config.ts` (shared with Vite)? Resolved at implementation time by reading viteplus.dev docs / vp CLI help output. If config is shared with `vite.config.ts`, this proposal does NOT touch the existing showcase Vite config — orchestrator config goes at repo root, separate from package-internal Vite configs.

- **vp's task-dispatch invocation pattern:** Does vp use `vp run <task>` or `vp <task>` or some other shape? Verify before authoring `package.json` scripts. This proposal assumes `vp run <task>`.

- **vp's task-graph derivation source:** Does vp derive dependencies from package.json scripts ordering, from workspace `dependencies`, or only from explicit vp.config.ts task definitions? D4 commits to explicit definitions regardless, but answer affects how minimal vp.config.ts can be.

- **vp's stderr/exit-code preservation when wrapping shell scripts:** Does `vp run <task>` whose body is `bash script.sh` faithfully propagate stderr and exit code? D6's falsification probes are the verification.

- **vp's content-addressed cache configuration:** Does the cache work without explicit config or does each task need a cache-key declaration? If the latter, this proposal needs to declare cache keys for each tier. Verify before merge.

- **vp install action for CI:** Does VoidZero publish a `setup-vp` GitHub Action analogous to `oven-sh/setup-bun`? If yes, use it. If no, use `bun add vite-plus@<pinned>` in CI. Verify.

- **Hygiene tier dispatch via vp:** Does `vp run hygiene` work cleanly when the task body is `bash scripts/hygiene/run.sh` and the script uses `git stash create` + `git reset --hard` semantics under the hood? Probe with smoke run. If incompatible, hygiene stays on direct bash invocation in this slice.
