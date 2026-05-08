## Why

The animus monorepo's vp-arc decomposition (per `orchestration-architecture/spec.md` Requirement "Follow-On Policy Decomposition", lines 150-156) names five cutover slices. Five shipped before this proposal: `migrate-lint-to-vp-check`, `migrate-orchestrator-to-vp-run`, `migrate-hygiene-cascade-to-oxlint`, `finalize-biome-to-oxlint-residue`, `migrate-test-to-vp-test`, and `resolve-clean-surface`. This proposal closes the **library bundler** slice — the line in the spec reading "A change rebinding the library bundler" — under a phased decomposition: A2.1 closes the dispatch question via the existing `vp run build:ts` task, while A2.2 (`migrate-build-to-vp-pack`) is reserved as a future engine-swap policy slice for when vp pack matures.

The slice is the smallest in the arc by surface area: dispatch through `vp run build:ts` was already migrated when `migrate-orchestrator-to-vp-run` shipped (`vite.config.ts:188-190` already exists; root `rebuild` script already chains `vp run build:all`). A2.1's substantive delta is therefore spec reconciliation: aligning `rolldown-build/spec.md`'s language with the engine-identity-only interpretation that the bundler-engine identity (Rolldown) is the actual contract, while the wrapper (tsdown today, vp pack future) is negotiable. After this slice ships, the vp-arc decomposition reaches 7/7 closed slices; A2.2 remains as an explicit, separable future thread.

## What Changes

**Spec reconciliation on `rolldown-build/spec.md`** (3 MODIFIED requirement blocks; no behavioral change to the build pipeline):

- **MODIFIED** Requirement "Rolldown as library bundler" — refresh stale legacy package references (`packages/core`, `packages/theming`, `packages/ui` are archived under `legacy/`) to the current published package set; clarify that "Rolldown" names the bundler ENGINE while the orchestrator binding (currently `tsdown` invoked via `vp run build:ts`) is the wrapper.
- **MODIFIED** Requirement "Shared Rolldown base config" — acknowledge the current shared-config surface is `tsdown.config.base.ts` (imported by per-package `tsdown.config.ts` files); allow either wrapper's config in the future under engine-identity-only interpretation.
- **MODIFIED** Requirement "Binding to orchestration-architecture" — replace the "future rebind to direct `vp pack` invocation" framing with engine-identity-only language: A2.1 closes orchestration-architecture line 154 via the current `vp run build:ts` dispatch (which itself dispatches to `tsdown` wrapping Rolldown). A2.2 (`migrate-build-to-vp-pack`) is reserved as a future engine-swap policy slice for when vp pack matures (post-GA + bake time). Stale-reference refresh, previously deferred to A2.2 by the spec text, is absorbed by A2.1 since A2.1 IS the rebind closure.

**Unchanged**: Requirements "No Babel in build pipeline" (still 100% accurate) and "Build output equivalence" ("Rolldown build output" reads as engine-output and remains true).

**No behavioral changes**:

- No engine swap — `tsdown` stays. No `tsdown.config.ts` files modified or deleted.
- No `package.json` script changes — `vp run build:ts` already dispatches to per-package `build:ts` scripts via `migrate-orchestrator-to-vp-run`.
- No `CLAUDE.md` edits — the dispatch-convention statement already covers `build:*` tasks accurately.
- No consumer-contract changes — `.js` + `.d.ts` outputs preserved.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `rolldown-build`: refresh stale legacy package references in Requirement "Rolldown as library bundler"; align Requirement "Shared Rolldown base config" with the current `tsdown.config.ts` shared-config surface; replace the "direct `vp pack` invocation" framing in Requirement "Binding to orchestration-architecture" with engine-identity-only language that closes the line-154 rebind via `vp run build:ts` dispatch and reserves `migrate-build-to-vp-pack` as a future engine-swap policy slice.

## Impact

**Affected code**:

- `openspec/specs/rolldown-build/spec.md` (3 MODIFIED requirement blocks applied via this change's spec delta on archive)

**Affected dependencies**: None.

**Affected systems**:

- Local build invocation: unchanged. `vp run build:ts` already dispatches to `tsdown && tsgo -p tsconfig.build.json` per package.
- CI: unchanged. `verify:ci` continues to invoke `build:ts` via `vp run` task graph.
- Consumer contract: unchanged. Published packages continue emitting `.js` (ESM via `type: "module"`) + `.d.ts` (via `tsgo`).
- vp-arc state: transitions from 6/7 closed slices to 7/7 closed slices. A2.2 (`migrate-build-to-vp-pack`) remains as an explicit future engine-swap policy slice, not part of the original decomposition's closure requirement.

**Verification tier set per Change-Type Map**: this touches `openspec/specs/**` only. Per CLAUDE.md, openspec changes use `openspec validate <change> --strict` instead of a verify tier. Plus a post-archive `vp run verify` (fast gate) sanity check to confirm baseline holds.

## Risk Acceptance

This proposal is gated by `orchestration-architecture/spec.md` Requirement "Migration Trigger Criteria" Scenario "Pre-GA cutover requires risk-acceptance" because vite-plus 0.1.20 has not reached GA per the VoidZero release channel.

**Specific alpha-status exposure for this cutover slice**:

- This is the LOWEST-risk slice in the arc — it ships ZERO behavioral changes. The dispatch through `vp run build:ts` already exists and was proven by the prior `migrate-orchestrator-to-vp-run` slice.
- The change is essentially spec reconciliation: aligning `rolldown-build/spec.md` text with the engine-identity-only interpretation explicitly chosen by the maintainer in the session-98 brainstorm (2026-05-08).
- No consumer-visible artifact changes; no engine swap; no per-package script edits; no `CLAUDE.md` edits; no `tsdown.config.ts` edits.
- Failure mode if the alpha-status exposure manifests: a future vp orchestrator regression could break `vp run build:ts` dispatch — but this risk EXISTS TODAY independent of this slice (the dispatch shipped in `migrate-orchestrator-to-vp-run`), so A2.1 does NOT introduce new exposure; it only documents the existing state.

**Mitigations**:

1. **Behavioral identity**: zero behavioral change. The build pipeline (`tsdown && tsgo`) executes identically pre- and post-archive.
2. **Reversibility**: spec edits only. A single `git revert <merge-commit>` restores all 3 MODIFIED requirement blocks to their prior text.
3. **Engine preservation**: `tsdown` stays as the wrapper; Rolldown remains the engine; declaration emission via `tsgo` is unchanged.
4. **Future engine-swap thread is preserved**: A2.2 (`migrate-build-to-vp-pack`) is explicitly reserved in the amended spec text as a future policy slice; engine swap is not pre-empted, just deferred.
5. **Empirical probe of vp pack runs AFTER A2.1 ships**: per session-98 user direction ("Then let's see if it can do what we want"), the probe results are captured to memory as A2.2 informing material, not blocking A2.1.

**Maintainer sign-off**: codecaaron (repository maintainer) authorized this slice via session-98 brainstorm (2026-05-08), explicitly answering Q1 "spec strictness" as "Engine-identity only" and Q2 "A2 motivation" as "Close vp-arc to 7/7", and selecting Approach 2 (phased) with the directive "Approach 2 - Then let's see if it can do what we want." Maintainer accepts alpha-status risk as a known-and-acceptable tradeoff given the slice ships zero behavioral changes.

This signed risk acceptance satisfies pre-GA Criterion B per `orchestration-architecture/spec.md` Requirement "Migration Trigger Criteria".
