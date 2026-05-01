## 1. Discovery (resolves design.md Open Questions)

- [ ] 1.1 Verify vp config filename and format. Run `bun x vp --help` and read https://viteplus.dev/guide. Record: config filename (`vite.config.ts` vs `vite.config.ts` vs other), task-definition syntax shape, whether config is plain TS or requires a specific helper import. Captures grounding for task 2.1.
- [ ] 1.2 Verify vp's task-graph derivation source. Determine whether vp infers task DAG from `package.json` `dependencies`, from script ordering, or only from explicit declarations in `vite.config.ts`. Affects how aggressive task 2.3's explicit-dependency declarations need to be.
- [ ] 1.3 Verify vp run's stderr / exit-code preservation when wrapping shell scripts. Author a minimal probe: a task whose body is `bash -c 'echo "FAIL on stderr" >&2; exit 17'` and confirm vp run propagates the exact stderr line and exit code 17. If vp swallows stderr or alters exit codes, halt this proposal — D6's falsification contract cannot be met. Surface upstream to VoidZero.
- [ ] 1.4 Verify vp's content-addressed cache configuration. Determine whether the cache works out-of-the-box for shell-task bodies or requires explicit cache-key declarations per task. If explicit, draft cache-key strategy for at least one tier (e.g., `verify:canary` keyed on NAPI binary mtime + tier-script hash) and capture as a task 2.x sub-item.
- [ ] 1.5 Verify CI install mechanism. Determine whether VoidZero publishes a setup-vp GitHub Action analogous to `oven-sh/setup-bun@v2`. If yes, use it in task 6.1. If no, use `bun add vite-plus@<pinned>` as a CI step.
- [x] 1.6 Pick pinned vite-plus version. **PINNED VERSION:** `vite-plus@0.1.20`. Selection criterion: `latest` on npm at PoC time (session 92, 2026-04-30); confirmed working for orchestrator-dispatch parity in PoC. Note: vp docs label v0.1.x as alpha though npm tags it `latest` — risk acceptance covers this asymmetry per `proposal.md` Risk Acceptance.
- [ ] 1.7 Verify Vite+ alpha satisfies bun-support claim. Run a smoke `vp --version` after install in a bun-managed workspace and confirm no warnings about unsupported PM. If install fails or warnings surface about bun, re-evaluate the cutover (kick to GA-only criterion).

## 2. Install vite-plus and author vite.config.ts

- [ ] 2.1 Install vite-plus as root devDependency at pinned version: `bun add -D vite-plus@<version-from-1.6>`. Verify entry in root `package.json` `devDependencies` is exact (no `^` or `~`).
- [ ] 2.2 Run `bun install` to materialize `bun.lockb` with vite-plus entry. Verify vp CLI invokable: `bun x vp --version` returns the pinned version.
- [ ] 2.3 Create `vite.config.ts` at repo root. Use the format / helper-import pattern resolved in task 1.1.
- [ ] 2.4 Define atomic-tier tasks in `vite.config.ts`, one per tier, each task body = `bash scripts/verify/<tier>.sh`:
  - `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`, `verify:hygiene:rust`
- [ ] 2.5 Define composite orchestrator tasks with explicit task dependencies (per design D4):
  - `verify` depends on `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:ts`, `verify:unit:rust`, `verify:canary` (in order, fail-fast)
  - `verify:full` depends on `verify` plus `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`
  - `verify:ci` follows the CI ordering (lint → unit:rust → hygiene:rust → build:extract → build:ts → compile → types → unit:ts → canary → integration → build:showcase → assert:showcase) per `verification-tier-policy` § verify:ci CI-Simulation Semantics
  - `verify:next` chains `verify:build:next` then `verify:assert:next`
  - `verify:showcase` chains `verify:build:showcase` then `verify:assert:showcase`
- [ ] 2.6 Define build pipeline tasks in `vite.config.ts`:
  - `build:extract` task body invokes `cd packages/extract && napi build --platform --release` (or equivalent — preserves cargo + napi-cli ownership per Rust-pipeline exclusion)
  - `build:ts` task body uses vp's per-package fan-out OR explicit per-package task dependencies declaring topological order (e.g., extract → properties → system → vite-plugin / next-plugin)
  - `build:all` depends on `build:extract` then `build:ts`
- [ ] 2.7 Define `hygiene` task with body `bash scripts/hygiene/run.sh`. Verify flag-passthrough works: `vp run hygiene -- --apply` propagates `--apply` to the shell script.
- [ ] 2.8 Verify `vite.config.ts` parses without TypeScript errors: `bun x tsc --noEmit vite.config.ts` (or equivalent — depends on whether tsconfig includes the file).

## 3. Migrate package.json scripts (HARD CUTOVER — delete migrated entries)

Per D2: every migrated tier name lives in `vite.config.ts` `run.tasks` ONLY. The corresponding `package.json` `scripts` entry is **deleted** (not aliased) so a single source of truth exists per Vite+'s "name in one or the other but not both" constraint. `bun run <migrated-name>` returns "script not found" post-migration — by design.

- [ ] 3.1 **Delete** these atomic-tier `verify:*` entries from root `package.json` `scripts`: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:build:vite`, `verify:assert:next`, `verify:assert:showcase`, `verify:assert:vite`, `verify:hygiene:rust`. Each name now lives only in `vite.config.ts` `run.tasks`.
- [ ] 3.2 **Delete** these composite-orchestrator entries: `verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`, `verify:vite`. Each becomes a vp task with `dependsOn` array.
- [ ] 3.3 **Delete** `build:all`, `build:extract`, `build:ts`, `build:showcase`, `rebuild` (rebuild is `clean:full && build:all`, both replaceable as a vp composite). Keep `build` only if it remains an alias for `build:ts` or `build:all`; if so, delete the alias too and document `vp run build:all` as the canonical surface. Also delete `verify:compile:tsc-fallback` (slated for removal) and `compile:tsc-fallback` workspace-filter entry.
- [ ] 3.4 **Delete** `hygiene` from root `package.json` scripts; vp dispatches `bash scripts/hygiene/run.sh` as task body. Verify flag passthrough works for `vp run hygiene -- --apply` (Phase 3 hygiene-specific smoke test, see task 4.x).
- [ ] 3.5 **Keep** unmigrated scripts in `package.json` `scripts`: `clean`, `clean:light`, `clean:full` (destructive shells, not migrated), `dev:showcase` (long-running watch), `test` (bun test, future migration), `compile` (workspace-filter alias for ad-hoc inner-package compile), `lint`, `format`, `check`, `check:fix` (biome wrappers, not migrated), `release` (one-shot release.sh), `deploy:showcase` (one-shot deploy). These continue to be invoked via `bun run X`.
- [ ] 3.6 **Update `_preconditions.sh` ROOT-script fix-command messages** from `bun run` to `vp run`: lines 45 (`bun run build:extract` → `vp run build:extract`), 51 (same), 178 (`bun run build:ts` → `vp run build:ts`), 190 (same). Per-package `--filter` messages (e.g., `bun run --filter '@animus-ui/system' build:ts`) STAY unchanged — `--filter` ad-hoc dispatch is not migrated. Update the in-file usage docstring in `scripts/hygiene/run.sh` line 27 from `bun run hygiene [flags]` to `vp run hygiene -- [flags]`.
- [ ] 3.7 **Update `assert-{showcase,vite,next}.sh` `require_dir` fix-command args** at line 12 of each: `bun run verify:build:<X>` → `vp run verify:build:<X>`.
- [ ] 3.8 **Update `scripts/hygiene/run.sh` safety-envelope invocations** at lines 435 + 438: `bun run verify:compile` → `vp run verify:compile`; `bun run verify:lint` → `vp run verify:lint`. This creates a two-level dispatch (vp → bash → vp), which D1 accepts; verify no recursion or shell-state leak via Phase 3 hygiene smoke.
- [ ] 3.9 **Update `scripts/hygiene/presenter.ts:195`** Layer-D NOTE text from `bun run verify:build:*` → `vp run verify:build:*`.
- [ ] 3.10 **Remove the `packageManager: bun@1.3.13` field** from root `package.json` (PoC carryover; mismatches `.tool-versions: bun 1.3.11`). `.tool-versions` is the sole bun-version source per `verification-tier-policy` Bun Version Pin requirement.
- [ ] 3.11 Run `bun install` to refresh lockfile after script-block changes and `packageManager` removal. Confirm: lockfile updates cleanly; no error from removed scripts; `bun run check` (unmigrated) still works as a sanity check.

## 4. Local smoke test (verify dispatch + composition)

- [ ] 4.1 `bun run clean:full && bun install && bun run build:extract` — establish a clean state with NAPI binary + lockfile fresh.
- [ ] 4.2 Run `vp run verify:lint`. Confirm: passes; output identical to direct `bash scripts/verify/lint.sh` invocation.
- [ ] 4.3 Run `vp run verify:compile && vp run verify:types`. Confirm both pass.
- [ ] 4.4 Run `vp run verify:unit:rust`. Confirm passes.
- [ ] 4.5 Run `bun run build:ts` (now routing through vp). Verify all TS packages build in correct dependency order. Confirm `packages/system/dist/`, `packages/extract/dist/`, `packages/properties/dist/`, etc. populate correctly.
- [ ] 4.6 Run `vp run verify:canary`. Confirm passes (NAPI present from step 4.1).
- [ ] 4.7 Run `vp run verify:integration`. Confirm passes (extract+system dist fresh from step 4.5).
- [ ] 4.8 Run `vp run verify`. Confirm full fast-gate composes in correct order, all tiers pass.
- [ ] 4.9 Confirm hard-cutover surface: `bun run verify` returns `error: Script not found "verify"`; `bun run verify:compile` returns `error: Script not found "verify:compile"` (exit non-zero, exact "script not found" message from bun). This is the expected behavior post-migration — `vp run` is the only invocation surface for migrated names. Unmigrated names (e.g., `bun run check`, `bun run clean:light`) MUST continue to work normally.
- [ ] 4.10 Run `vp run verify:full`. Confirm fast-gate + integration + build:next + build:showcase + assert:next + assert:showcase all pass end-to-end.

## 5. Falsification probes (D6 — loud-fail contract verification)

- [ ] 5.1 **Probe: missing NAPI surfaces loud-fail under vp.** `rm packages/extract/*.node`. Run `vp run verify:canary`. Confirm exact stderr line: `ERROR: NAPI binary missing. Run: bun run build:extract`. Confirm exit code is non-zero. Confirm no rebuild was triggered (NAPI still absent after run). Restore: `bun run build:extract`.
- [ ] 5.2 **Probe: stale dist surfaces loud-fail under vp.** Ensure clean state with all dists fresh. Then `touch packages/system/src/types/config.ts` (or any source under `packages/system/src/**`). Run `vp run verify:integration`. Confirm exact stderr line: `ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts`. Confirm exit code is non-zero. Confirm integration tests did NOT run. Restore: `bun run --filter '@animus-ui/system' build:ts`.
- [ ] 5.3 **Probe: missing cargo-machete surfaces tool-precondition failure under vp.** Temporarily mask cargo-machete from PATH: `mv $(which cargo-machete) /tmp/.machete-backup`. Run `vp run verify:hygiene:rust`. Confirm exact stderr line: `ERROR: cargo-machete missing. Run: cargo install cargo-machete`. Confirm exit code is non-zero. Restore: `mv /tmp/.machete-backup $(dirname $(which cargo)/cargo-machete)`.
- [ ] 5.4 **Probe: atomic-tier isolation — vp does NOT silently rebuild.** With clean state, `rm -rf packages/extract/dist/`. Run `vp run verify:integration`. Confirm precondition fails with the appropriate rebuild command (`bun run --filter '@animus-ui/extract' build:ts`). Confirm `packages/extract/dist/` is STILL ABSENT after the run (no silent rebuild). Restore: `bun run --filter '@animus-ui/extract' build:ts`.
- [ ] 5.5 **Probe: hard-cutover surface for migrated names.** After migration, run `bun run verify:canary`. Confirm: bun emits its standard "script not found" error and exits non-zero. The `verify:canary` name is no longer in `package.json` `scripts` — only in `vite.config.ts` `run.tasks`. This validates D2's hard-cutover semantics: migrated names are exclusively `vp run`-dispatched. Then run `bun run check` (unmigrated): confirm it still works (sanity check that we didn't break unmigrated names).
- [ ] 5.6 If ANY of probes 5.1–5.5 fails (vp swallows stderr, alters exit code, silent rebuilds, or messages drift), halt the cutover and rollback. Document the failure mode and surface upstream.

## 6. CI workflow migration

- [ ] 6.1 Add vite-plus install step to `.github/workflows/ci.yaml` in every job that runs a tier (lint, test-rust, hygiene-rust, build-extract, verify, test-showcase). Use the install mechanism resolved in task 1.5 (setup-vp action OR `bun add vite-plus@<pinned>` step). Place the install step AFTER `bun install` and BEFORE the first tier invocation.
- [ ] 6.2 Replace each `bun run verify:*` invocation in `.github/workflows/ci.yaml` with `vp run verify:*`. Specifically affects: `lint`, `test-rust`, `hygiene-rust`, `verify`, `test-showcase` jobs (any job that has `bun run` followed by a verify-tier name).
- [ ] 6.3 Replace each `bun run build:*` invocation in CI with `vp run build:*` (specifically `bun run build:extract` and `bun run build:ts` if invoked directly). Confirm CI ordering remains: build-extract job → build:ts subsequent steps.
- [ ] 6.4 Confirm `verify:ci` composite is NOT invoked from CI itself (it's a local CI-mirror). CI continues to invoke its own discrete jobs.
- [ ] 6.5 Push changes to a CI preview branch (NOT `next` or `main`). Confirm: vite-plus install step succeeds in every job; all jobs pass green; total CI runtime is within ~10% of pre-cutover baseline (vp's caching may improve runtime, regression beyond 10% slower flags as a problem).
- [ ] 6.6 Validate loud-fail surfaces in CI. On the preview branch, push a commit that synthetically breaks one tier (e.g., add a TS error to a system source file). Confirm CI fails on the appropriate job (`verify` or equivalent), the failure message is the exact loud-fail shape, and the failing tier is identifiable from CI logs.

## 7. Root CLAUDE.md migration

- [ ] 7.1 Update root `CLAUDE.md` `Verification Tiers → Atomic Tiers` table `Command` column entries: replace `bun run verify:lint` → `vp run verify:lint`, and the same pattern for every row (`compile`, `types`, `unit:ts`, `unit:rust`, `canary`, `integration`, `build:next`, `build:showcase`, `build:vite`, `assert:next`, `assert:showcase`, `assert:vite`, `hygiene:rust`).
- [ ] 7.2 Update root `CLAUDE.md` `Verification Tiers → Composite Orchestrators` table `Command` column entries: replace `bun run verify` → `vp run verify`, same for `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`, `verify:vite`.
- [ ] 7.3 Update root `CLAUDE.md` `Change-Type Map` `Run` column entries: every `bun run X && bun run Y` style pattern becomes `vp run X && vp run Y`. Specifically affects 12 rows covering each edit-surface mapping.
- [ ] 7.4 Add a one-line note immediately above the `Verification Tiers` table heading: `> \`vp run X\` is the canonical and only invocation path for migrated tasks; \`bun run\` continues to work for unmigrated scripts (\`clean*\`, \`dev:showcase\`, \`test\`, biome wrappers, \`release\`, etc.).`
- [ ] 7.5 Update the `Key Rules` section's "Atomic tiers fail loud, never silently rebuild" bullet to reference `vp run Y` instead of `bun run Y` in the example error-message snippet (e.g., `On 'ERROR: X missing. Run: vp run build:extract', run that and retry.`). Add a new Key Rule: "**vp env stays disabled**. \`vp env use\` SHALL NOT be invoked locally or in CI for this repo. \`.tool-versions\` is the sole bun-version source of truth (it broke tsdown's unrun resolver in PoC session 92)."
- [ ] 7.6 Update per-package `CLAUDE.md` doc references for migrated tier names. Specifically: `packages/extract/CLAUDE.md` (`bun run build:extract` → `vp run build:extract`; `bun run build:ts` → `vp run build:ts`; `bun run clean:light` STAYS — clean is unmigrated); `packages/showcase/CLAUDE.md` (`bun run verify:showcase` → `vp run verify:showcase`; `bun run clean:light` STAYS); `packages/vite-plugin/CLAUDE.md` (`bun run clean:light` STAYS); `packages/_assertions/CLAUDE.md` (`bun run build:ts` → `vp run build:ts`).
- [ ] 7.7 Update `scripts/hygiene/CLAUDE.md` `Commands` table `Command` column entries from `bun run hygiene` to `vp run hygiene -- [flags]` (with the doc note that `bash scripts/hygiene/run.sh` continues to work as direct-shell invocation). Update the end-of-work-only contract bullet to enforce that `vp run hygiene` ALSO must NOT appear in `.github/workflows/*.yaml`.

## 8. Final end-to-end verification

- [ ] 8.1 Clean checkout from current branch: `git stash && bun run clean:full && bun install && bun run build:extract`. Establish a fresh state.
- [ ] 8.2 Run `vp run verify:full` end-to-end on this fresh state. Confirm all tiers green.
- [ ] 8.3 Run all 5 falsification probes from section 5 again on this fresh state. Confirm all surface their loud-fail messages correctly.
- [ ] 8.4 Verify rollback procedure works as designed (D7). On a throwaway branch off the cutover commit:
  - Revert `vite.config.ts` (delete file)
  - Revert `package.json` `scripts` block to pre-cutover state
  - Revert `.github/workflows/ci.yaml` to pre-cutover state
  - Revert root `CLAUDE.md` tier table + Change-Type Map sections
  - Revert `scripts/hygiene/CLAUDE.md` if updated in 7.7
  - `bun remove vite-plus`
  - `bun install`
  - Confirm `bun run verify:canary` works via direct shell path (no vp involved)
  - Confirm tier scripts under `scripts/verify/*.sh` and `scripts/hygiene/*.sh` are still byte-identical to pre-cutover state (no incidental edits leaked)
  - Confirm full `bun run verify` passes
  - Discard the throwaway branch
- [ ] 8.5 Push cutover commit to a CI preview branch. Confirm full CI run green. Confirm CI runtime is comparable to pre-cutover baseline (per task 6.5 threshold).
- [ ] 8.6 Run `bun run hygiene` (transparent alias) on the cutover commit. Confirm hygiene cascade runs correctly under vp dispatch (scan mode default, restores worktree, prints recovery snapshot). Validates D1's hygiene-script-as-task-body decision under real load.

## 9. Risk acceptance + sign-off

- [ ] 9.1 Confirm `proposal.md` `## Risk Acceptance` section is signed by Aaron (sole maintainer) with the alpha-status exposure assessment specific to this orchestrator-rebind slice. Per the Migration Trigger Criteria contract, pre-GA cutover SHALL NOT merge without this signature.
- [ ] 9.2 Confirm risk acceptance scope is limited to this slice (orchestrator dispatch only) — does NOT extend to subsequent vp-related cutovers. Each follow-on requires its own slice-scoped risk acceptance.
