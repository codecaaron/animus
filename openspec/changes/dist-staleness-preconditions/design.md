## Context

The `verification-tier-policy` capability shipped 11 atomic tier scripts in `scripts/verify/`, each with inline shell preconditions. The NAPI binary check is the only mtime-based staleness guard; every other dist-consuming tier has an existence-only check. Observed failure mode during the `verification-tier-policy` apply: `verify:build:next` reported green against a stale `packages/system/dist/`, reversed to a real type error after explicit `bun run --filter '@animus-ui/system' build:ts`. The false-green was a single instance of a general class — any consumer tier can silently test against stale dist.

Current precondition surface (✓@now as of post-apply state):
- `scripts/verify/canary.sh` — NAPI exists + mtime > Rust src (✓ full stale check)
- `scripts/verify/integration.sh` — NAPI exists + mtime > Rust src + `extract/dist/index.mjs` exists (**no mtime check on extract dist, no check on system dist**)
- `scripts/verify/build-next.sh` — NAPI exists + mtime > Rust src + `extract/dist/index.mjs` exists (**no mtime check, no system/next-plugin dist check**)
- `scripts/verify/build-showcase.sh` — NAPI exists + mtime > Rust src + `extract/dist/index.mjs` exists (**no mtime check, no system/vite-plugin/properties dist check**)

Inline staleness logic is duplicated across 4 scripts. Duplication is the vector for the gap spreading further as more tiers are added.

## Goals / Non-Goals

**Goals:**
- Every tier that consumes a package `dist/` fails loud if that dist is stale relative to its owning package's `src/**`.
- The staleness-check pattern is implemented once, sourced by all tier scripts — one authoritative contract, not 4+ copies.
- Fail-loud messages stay consumer-actionable: each error line names the stale artifact AND the exact command to refresh it.
- The NAPI-specific pattern currently inline in 4 scripts collapses into the shared helper, reducing surface area.
- Helper-driven tier scripts are more legible — intent per tier is visible as `require_*` function calls, not a wall of `find` + `ls` one-liners.

**Non-Goals:**
- No new atomic tiers. No new composite orchestrators. Scope is preconditions only.
- No changes to the Change-Type Map, tier naming convention, or `verify:ci` composite semantics.
- No changes to the `packages/extract/*.node` artifact produced by the NAPI build; check logic moves into the helper but the artifact path and its freshness rule stay identical.
- No runtime handling of CSSObject-returning transforms — that's a separate concern flagged in `packages/system/src/types/config.ts`.
- No enforcement of dist-freshness outside the verify tier layer (e.g., at `bun install` time or via a workspace-wide hook).

## Decisions

### Decision 1: Helper library as a sourced shell file, not a spawned subprocess

`scripts/verify/_preconditions.sh` is designed to be sourced (`source "$ROOT/scripts/verify/_preconditions.sh"`) from each atomic tier script. Functions run in the caller's process.

**Rationale**: sourcing preserves the caller's exit semantics (`set -euo pipefail`, early-exit on error). Calling as a subprocess would require every function to propagate exit codes explicitly and the caller to check each one — more complex and more error-prone. Sourcing also avoids the cost of spawning a bash subprocess for each precondition.

**Alternatives considered**:
- TS utility via `bun`: gives richer errors and reusable types, but requires a TS runtime startup per tier. Shell is strictly lighter-weight and matches the existing `assert-*.sh` pattern. Reject.
- Inline in each tier script (no shared helper): the status quo. Duplication is the problem this change solves. Reject.

### Decision 2: Helper function naming — `require_*` prefix

All precondition functions are named `require_<noun>[_<modifier>]`: `require_bun_install`, `require_fresh_napi`, `require_fresh_package_dist`, `require_dir`. Every function is a contract assertion that exits non-zero with a readable error on failure.

**Rationale**: `require_*` reads naturally in the caller script as a sequence of assertions. It mirrors `set -e`-style "demand or abort" semantics without reaching for exceptions or return-code plumbing. Any maintainer reading a tier script sees "this tier requires X, Y, Z" as a top-of-file contract.

**Alternatives considered**:
- `check_*` prefix: ambiguous — could be read as "might succeed might fail, caller decides." Reject.
- `assert_*` prefix: closer to test-suite vocabulary; `require` is the more common shell-script idiom for "abort if not met." Minor preference for `require`.

### Decision 3: `require_fresh_package_dist <pkg>` signature takes one argument

Signature: `require_fresh_package_dist <pkg>` where `<pkg>` is the directory name under `packages/` (e.g., `system`, `extract`, `vite-plugin`, `next-plugin`, `properties`). Internally the helper:

1. Resolves the key dist artifact to check via probe order: `packages/<pkg>/dist/index.mjs` then `packages/<pkg>/dist/index.js` — whichever exists first is the key artifact. Both are valid published ESM entries: tsdown emits `.mjs` for some workspace packages (extract, vite-plugin, next-plugin) and `.js` for packages whose `package.json` declares `"type": "module"` (system, properties). If neither exists, the dist is considered missing. **This probe-order was amended during apply**: the initial design assumed universal `.mjs` emission, but reality has two patterns; amendment keeps the helper reality-aligned without changing the precondition contract's intent.
2. Resolves the source tree to check against. Default: `packages/<pkg>/src/**` for TS-only packages; for packages with Rust source, `src/**/*.rs` is also included.
3. Runs: existence check AND `find packages/<pkg>/src -newer <dist-artifact> -print -quit`.
4. On failure, prints `ERROR: packages/<pkg>/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/<pkg>' build:ts` and exits 1.

**Rationale**: one-argument call site is legible (`require_fresh_package_dist system`) and the helper encapsulates per-package defaults. Uniform contract — every consumer tier treats any upstream dist the same way.

**Alternatives considered**:
- Two-argument signature `require_fresh_package_dist <pkg> <artifact>` — more flexible but pushes the default-artifact knowledge out to every caller. Reject; caller repetition defeats the helper.
- Separate helper per package (`require_fresh_system_dist`, `require_fresh_extract_dist`, ...): explosion of function names. Reject.

### Decision 4: Fix command in the error message is derived, not hardcoded

The fail-loud message includes `Run: bun run --filter '@animus-ui/<pkg>' build:ts`, derived from the `<pkg>` argument. If the target package uses a different build script than `build:ts` (e.g., `extract` uses `build:extract`), the helper dispatches: for `extract`, suggest `bun run build:extract`; for other packages, suggest `bun run --filter '@animus-ui/<pkg>' build:ts`.

**Rationale**: the error message must be consumer-actionable without requiring the reader to know the workspace script naming convention. Special-casing `extract` in the helper is cheap and keeps one truth path for the NAPI refresh command.

**Alternatives considered**:
- Pass `<fix_command>` as a second argument: makes helper more flexible but duplicates the command across caller sites. Reject.
- Always suggest `bun run build:all`: works but is heavier than needed. Reject.

### Decision 5: NAPI check (`require_fresh_napi`) is a distinct function, not a variant of `require_fresh_package_dist`

The NAPI binary check has domain-specific shape: it looks for `packages/extract/*.node` (glob match, platform-varying name), compares against `packages/extract/src/**/*.rs` (Rust-source filter), and suggests `bun run build:extract` (not `build:ts`). Keeping it as its own function matches that domain shape, and the NAPI binary existence check is the first fail-loud call in every NAPI-dependent tier — factoring it out preserves readability.

**Rationale**: the package-dist check and the NAPI check differ in artifact identity (binary vs module), source filter (`.rs` vs `.ts|.tsx`), and fix command (`build:extract` vs `build:ts`). Forcing both into one function hurts legibility.

**Alternatives considered**:
- Parameterize `require_fresh_package_dist` to handle NAPI: possible but bloats the function's contract. Reject.

### Decision 6: Short-circuit on first failure, clear per-dist message

When a tier has multiple upstream dists (e.g., `verify:build:showcase` depends on 4 packages), each `require_*` call runs sequentially. First failure aborts the script with the failing artifact's specific error message. No enumeration of downstream failures.

**Rationale**: matches the existing `verification-tier-policy` Requirement "Shell-Based Fail-Loud Preconditions" short-circuit rule. Enumeration was explicitly deferred there as a Tier-3 follow-up; this proposal preserves the short-circuit semantics.

**Alternatives considered**:
- Enumerate all failures before exiting: better DX, more complex implementation. Defer to the already-queued Tier-3 item.

## Risks / Trade-offs

**[Risk] Helper bugs propagate to every tier.** A bug in `require_fresh_package_dist` breaks every consumer tier simultaneously. **Mitigation**: helper is ~30 lines of shell, kept deliberately minimal. Every tier script sources it so a regression surfaces in `verify` fast-gate on the first run. Unit-test-style validation (task: delete each dist in turn, confirm each tier fails with the exact expected message) covers the helper by exercising it through tier callers.

**[Risk] Helper introduces a new runtime dependency — `bash` with `source` support — that must exist on every runner.** **Mitigation**: this is already a requirement for the shipping tier scripts (`#!/usr/bin/env bash`, `set -euo pipefail`). CI runners have bash. Local macOS / Linux dev machines have bash. No new constraint.

**[Risk] Staleness checks false-positive on filesystem metadata edge cases** (e.g., clock skew on shared filesystems, touch-preserving git checkouts). **Mitigation**: mtime comparison via `find -newer` is the same mechanism the shipping NAPI check uses — if it bites, the whole precondition contract needs rethinking, not just this change. No worse than current state; arguably better because now every tier fails loud rather than silently passing.

**[Risk] Extending preconditions increases the wall-clock of `verify` fast-gate slightly.** **Mitigation**: `find -newer -print -quit` exits on first match; for clean workspaces with a dozen src files, this is <10ms. Negligible.

**[Trade-off] Tier scripts become dependent on a helper file's internal API (function names, argument shapes).** **Accepted**: this is the intended coupling. The alternative (no helper) is worse because every tier owns its own implementation and drifts.

**[Trade-off] One-argument helper hides per-package knowledge (artifact path, fix command) inside the helper.** **Accepted**: per-package specialization belongs centralized, not spread across 11 tier scripts. If a package's build output path changes, one helper edit updates every caller.

## Migration Plan

Single commit:

1. **Write `scripts/verify/_preconditions.sh`** with the four helper functions. Keep the file minimal and readable.
2. **Rewrite 11 atomic tier scripts** to source the helper and call the appropriate functions. Remove inline precondition logic.
3. **Extend preconditions** for `verify:integration`, `verify:build:next`, and `verify:build:showcase` per the dependency lists in the proposal.
4. **Run each tier in isolation** — confirm green state with fresh dist; confirm fail-loud precondition fires with each expected error shape when a dist is deliberately deleted or stale-touched.
5. **Update spec** via the MODIFIED + ADDED sections in this change's `specs/verification-tier-policy/spec.md`.
6. **Push + merge**. Expected CI signal: `verify` fast-gate passes; any stale dist in CI surfaces loudly rather than producing silent false signals.

Rollback: revert the single commit. Tier scripts return to their pre-helper inline form; the NAPI check continues to function exactly as before (unchanged semantically, just inline again).

## Open Questions

- **Should `verify:compile` and `verify:types` also gain staleness checks?** Leaning: **no**. Both read source directly via `tsc --noEmit`; no dist consumption. Adding checks would be defensive overreach. Revisit only if a use-case surfaces where `verify:compile` actually depends on a pre-built artifact.
- **Should the helper expose a `require_fresh_root_dist <pkg-1> <pkg-2> ...` convenience for multi-dep tiers?** Leaning: **no**. Sequential calls are already legible and naming each dep explicitly makes the tier's dependency graph visible. Revisit if tier scripts accumulate 5+ `require_fresh_package_dist` calls.
- **What about indirect dist dependencies** (e.g., `system` depends on `properties` and `core`; does a stale `properties/dist/` cause issues when only `system` is checked)? Leaning: **transitive staleness is out of scope for this change**. The assumption is that `bun run build:ts` across workspace packages runs in dependency order, so a fresh `system/dist/` presupposes a fresh `properties/dist/`. If that assumption breaks in practice, a follow-up change adds transitive checks.
