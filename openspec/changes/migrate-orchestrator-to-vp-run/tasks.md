## 1. Discovery (resolves design.md Open Questions)

- [ ] 1.1 Verify vp config filename and format. Run `bun x vp --help` and read https://viteplus.dev/guide. Record: config filename (`vp.config.ts` vs `vite.config.ts` vs other), task-definition syntax shape, whether config is plain TS or requires a specific helper import. Captures grounding for task 2.1.
- [ ] 1.2 Verify vp's task-graph derivation source. Determine whether vp infers task DAG from `package.json` `dependencies`, from script ordering, or only from explicit declarations in `vp.config.ts`. Affects how aggressive task 2.3's explicit-dependency declarations need to be.
- [ ] 1.3 Verify vp run's stderr / exit-code preservation when wrapping shell scripts. Author a minimal probe: a task whose body is `bash -c 'echo "FAIL on stderr" >&2; exit 17'` and confirm vp run propagates the exact stderr line and exit code 17. If vp swallows stderr or alters exit codes, halt this proposal — D6's falsification contract cannot be met. Surface upstream to VoidZero.
- [ ] 1.4 Verify vp's content-addressed cache configuration. Determine whether the cache works out-of-the-box for shell-task bodies or requires explicit cache-key declarations per task. If explicit, draft cache-key strategy for at least one tier (e.g., `verify:canary` keyed on NAPI binary mtime + tier-script hash) and capture as a task 2.x sub-item.
- [ ] 1.5 Verify CI install mechanism. Determine whether VoidZero publishes a setup-vp GitHub Action analogous to `oven-sh/setup-bun@v2`. If yes, use it in task 6.1. If no, use `bun add vite-plus@<pinned>` as a CI step.
- [ ] 1.6 Pick pinned vite-plus alpha version. Record version string here in this tasks.md (replacing this placeholder): **PINNED VERSION:** `vite-plus@<resolved-at-impl-time>`. Selection criterion: latest stable alpha release at implementation time, with no open critical issues against bun-workspace dispatch.
- [ ] 1.7 Verify Vite+ alpha satisfies bun-support claim. Run a smoke `vp --version` after install in a bun-managed workspace and confirm no warnings about unsupported PM. If install fails or warnings surface about bun, re-evaluate the cutover (kick to GA-only criterion).

## 2. Install vite-plus and author vp.config.ts

- [ ] 2.1 Install vite-plus as root devDependency at pinned version: `bun add -D vite-plus@<version-from-1.6>`. Verify entry in root `package.json` `devDependencies` is exact (no `^` or `~`).
- [ ] 2.2 Run `bun install` to materialize `bun.lockb` with vite-plus entry. Verify vp CLI invokable: `bun x vp --version` returns the pinned version.
- [ ] 2.3 Create `vp.config.ts` at repo root. Use the format / helper-import pattern resolved in task 1.1.
- [ ] 2.4 Define atomic-tier tasks in `vp.config.ts`, one per tier, each task body = `bash scripts/verify/<tier>.sh`:
  - `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`, `verify:hygiene:rust`
- [ ] 2.5 Define composite orchestrator tasks with explicit task dependencies (per design D4):
  - `verify` depends on `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:ts`, `verify:unit:rust`, `verify:canary` (in order, fail-fast)
  - `verify:full` depends on `verify` plus `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`
  - `verify:ci` follows the CI ordering (lint → unit:rust → hygiene:rust → build:extract → build:ts → compile → types → unit:ts → canary → integration → build:showcase → assert:showcase) per `verification-tier-policy` § verify:ci CI-Simulation Semantics
  - `verify:next` chains `verify:build:next` then `verify:assert:next`
  - `verify:showcase` chains `verify:build:showcase` then `verify:assert:showcase`
- [ ] 2.6 Define build pipeline tasks in `vp.config.ts`:
  - `build:extract` task body invokes `cd packages/extract && napi build --platform --release` (or equivalent — preserves cargo + napi-cli ownership per Rust-pipeline exclusion)
  - `build:ts` task body uses vp's per-package fan-out OR explicit per-package task dependencies declaring topological order (e.g., extract → properties → system → vite-plugin / next-plugin)
  - `build:all` depends on `build:extract` then `build:ts`
- [ ] 2.7 Define `hygiene` task with body `bash scripts/hygiene/run.sh`. Verify flag-passthrough works: `vp run hygiene -- --apply` propagates `--apply` to the shell script.
- [ ] 2.8 Verify `vp.config.ts` parses without TypeScript errors: `bun x tsc --noEmit vp.config.ts` (or equivalent — depends on whether tsconfig includes the file).

## 3. Migrate package.json scripts

- [ ] 3.1 Replace each `verify:*` atomic-tier script entry with `"verify:<tier>": "vp run verify:<tier>"`. Specifically: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`, `verify:hygiene:rust`.
- [ ] 3.2 Replace each composite orchestrator entry with `"verify": "vp run verify"`, `"verify:full": "vp run verify:full"`, `"verify:ci": "vp run verify:ci"`, `"verify:next": "vp run verify:next"`, `"verify:showcase": "vp run verify:showcase"`.
- [ ] 3.3 Replace each `build:*` script entry with `"build:<scope>": "vp run build:<scope>"`. Specifically: `build`, `build:all`, `build:extract`, `build:ts`. Confirm `build` aliases to `build:all` (or `build:ts` depending on current convention).
- [ ] 3.4 Replace `"hygiene": "..."` with `"hygiene": "vp run hygiene"`.
- [ ] 3.5 Leave `clean`, `clean:light`, `clean:full`, `rebuild` scripts as direct shell invocations — vp does NOT dispatch cleaning in this slice (per design.md non-goals; cleaning surface reserved for `resolve-clean-surface` follow-on).
- [ ] 3.6 Leave `lint`, `format`, `check`, `check:fix` as direct biome invocations (per design.md non-goals; lint rebind reserved for `migrate-lint-to-vp-check` follow-on). These are NOT tier scripts; they are direct-tool aliases.
- [ ] 3.7 Run `bun install` again to refresh lockfile against the modified scripts. Verify `bun run verify --help` (or any single tier) routes through vp without error.

## 4. Local smoke test (verify dispatch + composition)

- [ ] 4.1 `bun run clean:full && bun install && bun run build:extract` — establish a clean state with NAPI binary + lockfile fresh.
- [ ] 4.2 Run `vp run verify:lint`. Confirm: passes; output identical to direct `bash scripts/verify/lint.sh` invocation.
- [ ] 4.3 Run `vp run verify:compile && vp run verify:types`. Confirm both pass.
- [ ] 4.4 Run `vp run verify:unit:rust`. Confirm passes.
- [ ] 4.5 Run `bun run build:ts` (now routing through vp). Verify all TS packages build in correct dependency order. Confirm `packages/system/dist/`, `packages/extract/dist/`, `packages/properties/dist/`, etc. populate correctly.
- [ ] 4.6 Run `vp run verify:canary`. Confirm passes (NAPI present from step 4.1).
- [ ] 4.7 Run `vp run verify:integration`. Confirm passes (extract+system dist fresh from step 4.5).
- [ ] 4.8 Run `vp run verify`. Confirm full fast-gate composes in correct order, all tiers pass.
- [ ] 4.9 Run `bun run verify` (transparent alias path). Confirm execution is identical to step 4.8 — same tier order, same pass/fail.
- [ ] 4.10 Run `vp run verify:full`. Confirm fast-gate + integration + build:next + build:showcase + assert:next + assert:showcase all pass end-to-end.

## 5. Falsification probes (D6 — loud-fail contract verification)

- [ ] 5.1 **Probe: missing NAPI surfaces loud-fail under vp.** `rm packages/extract/*.node`. Run `vp run verify:canary`. Confirm exact stderr line: `ERROR: NAPI binary missing. Run: bun run build:extract`. Confirm exit code is non-zero. Confirm no rebuild was triggered (NAPI still absent after run). Restore: `bun run build:extract`.
- [ ] 5.2 **Probe: stale dist surfaces loud-fail under vp.** Ensure clean state with all dists fresh. Then `touch packages/system/src/types/config.ts` (or any source under `packages/system/src/**`). Run `vp run verify:integration`. Confirm exact stderr line: `ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts`. Confirm exit code is non-zero. Confirm integration tests did NOT run. Restore: `bun run --filter '@animus-ui/system' build:ts`.
- [ ] 5.3 **Probe: missing cargo-machete surfaces tool-precondition failure under vp.** Temporarily mask cargo-machete from PATH: `mv $(which cargo-machete) /tmp/.machete-backup`. Run `vp run verify:hygiene:rust`. Confirm exact stderr line: `ERROR: cargo-machete missing. Run: cargo install cargo-machete`. Confirm exit code is non-zero. Restore: `mv /tmp/.machete-backup $(dirname $(which cargo)/cargo-machete)`.
- [ ] 5.4 **Probe: atomic-tier isolation — vp does NOT silently rebuild.** With clean state, `rm -rf packages/extract/dist/`. Run `vp run verify:integration`. Confirm precondition fails with the appropriate rebuild command (`bun run --filter '@animus-ui/extract' build:ts`). Confirm `packages/extract/dist/` is STILL ABSENT after the run (no silent rebuild). Restore: `bun run --filter '@animus-ui/extract' build:ts`.
- [ ] 5.5 **Probe: bun run alias path preserves loud-fail.** Repeat probe 5.1 (missing NAPI) but invoke as `bun run verify:canary` (transparent alias). Confirm same exact stderr message and exit code. Validates that the bun → vp → tier-script chain doesn't swallow signals.
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
- [ ] 7.4 Add a one-line note immediately above the `Verification Tiers` table heading: `> \`bun run X\` continues to work as a transparent alias for \`vp run X\`; \`vp run\` is canonical.`
- [ ] 7.5 Update the `Key Rules` section's "Atomic tiers fail loud, never silently rebuild" bullet to reference `vp run Y` instead of `bun run Y` in the example error-message snippet (e.g., `On 'ERROR: X missing. Run: vp run build:extract', run that and retry.`).
- [ ] 7.6 Grep all per-package `CLAUDE.md` files for `bun run verify:` or `bun run build:` patterns. Per the existing per-package-files-link-back invariant, no per-package file should mention these directly. If any do, fix the drift surfaced (link back to root, don't duplicate).
- [ ] 7.7 Update `scripts/hygiene/CLAUDE.md` `Commands` table `Command` column entries from `bun run hygiene` to `vp run hygiene` (with `bun run hygiene` documented as transparent alias).

## 8. Final end-to-end verification

- [ ] 8.1 Clean checkout from current branch: `git stash && bun run clean:full && bun install && bun run build:extract`. Establish a fresh state.
- [ ] 8.2 Run `vp run verify:full` end-to-end on this fresh state. Confirm all tiers green.
- [ ] 8.3 Run all 5 falsification probes from section 5 again on this fresh state. Confirm all surface their loud-fail messages correctly.
- [ ] 8.4 Verify rollback procedure works as designed (D7). On a throwaway branch off the cutover commit:
  - Revert `vp.config.ts` (delete file)
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
