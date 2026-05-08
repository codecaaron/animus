## Context

This is the library-bundler slice of the vp-arc decomposition (per `orchestration-architecture/spec.md` Requirement "Follow-On Policy Decomposition", line 154: "A change rebinding the library bundler"). Six slices have shipped before this proposal; this slice closes the seventh — the last open vp-arc thread — under a phased decomposition where A2.1 closes the dispatch question and A2.2 (`migrate-build-to-vp-pack`) is reserved as a future engine-swap policy slice.

Current state at proposal time:

- The build dispatch already runs through `vp run build:ts` per `vite.config.ts:188-190`: `command: "bun run --filter './packages/*' build:ts"`. This task was added by `migrate-orchestrator-to-vp-run`.
- Each per-package `build:ts` script invokes `tsdown && tsgo -p tsconfig.build.json`. tsdown wraps Rolldown internally; tsgo emits `.d.ts` declarations.
- Root `package.json` `rebuild` script chains `vp run clean:full && vp run build:all` (per the `resolve-clean-surface` and `migrate-orchestrator-to-vp-run` slices).
- `rolldown-build/spec.md` references legacy package paths (`packages/core`, `packages/theming`, `packages/ui`) that are now archived under `legacy/`.
- `rolldown-build/spec.md` Requirement "Shared Rolldown base config" references `rolldown.config.ts`, but reality is `tsdown.config.base.ts` + per-package `tsdown.config.ts`.
- `rolldown-build/spec.md` Requirement "Binding to orchestration-architecture" frames vp pack as the future rebind target; this framing pre-empts engine-identity-only interpretation.
- An empirical probe of `vp pack` in session 97 (2026-05-08) revealed that vp pack does NOT read `tsdown.config.ts` and emits `.mjs`/`.d.mts` defaults, diverging from the current `.js`/`.d.ts` consumer contract.

Constraints (from `orchestration-architecture/spec.md` and `rolldown-build/spec.md`):

- Rolldown SHALL remain the bundling engine (engine-identity invariant).
- ESM SHALL remain the only emitted output format.
- Externalization of `node_modules` SHALL continue.
- TypeScript declaration files SHALL continue to be emitted.
- Pre-GA risk-acceptance documentation SHALL be present per Migration Trigger Criteria Criterion B.

Stakeholders: codecaaron (sole repository maintainer; Risk Acceptance signed via session-98 brainstorm directive on this proposal).

## Goals / Non-Goals

**Goals:**

- Close the orchestration-architecture line 154 ("library bundler" rebind) requirement via spec-language alignment with the engine-identity-only interpretation.
- Reframe `rolldown-build/spec.md` Requirement "Binding to orchestration-architecture" so that the existing `vp run build:ts` dispatch (which dispatches to `tsdown` wrapping Rolldown) IS the closure of the rebind requirement.
- Refresh stale legacy-package references in `rolldown-build/spec.md` (Requirement "Rolldown as library bundler"): replace `packages/core`/`theming`/`ui` with the current published package set.
- Align `rolldown-build/spec.md` Requirement "Shared Rolldown base config" with the current `tsdown.config.base.ts` shared-config surface, while preserving optionality for either wrapper's config in the future.
- Reserve `migrate-build-to-vp-pack` (A2.2) as a future engine-swap policy slice for when vp pack matures (post-GA + bake time).

**Non-Goals:**

- No engine swap. `tsdown` stays as the wrapper for A2.1.
- No `tsdown.config.ts` file edits or deletions.
- No per-package `package.json` script changes.
- No `CLAUDE.md` edits — the dispatch-convention statement and Atomic Tiers are already accurate for `build:*` tasks.
- No `vite.config.ts` changes — the `build:ts` task already exists.
- No empirical adoption of `vp pack`. The probe runs after A2.1 ships, captured to memory as A2.2 informing material.
- No consumer-contract changes (`.js`+`.d.ts` outputs preserved).
- No edits to `orchestration-architecture/spec.md` — per established pattern (A1 closure on `bun-test/spec.md`, A3 closure on `build-orchestration/spec.md`), each vp-arc slice closes on ITS OWN canonical spec.

## Decisions

### Decision 1: Phased decomposition (A2.1 closure now + A2.2 future engine-swap)

**Rationale**: The rolldown-build spec line 57 mandate "direct `vp pack` invocation" was authored before the empirical divergence between vp pack and tsdown was known (vp pack at 0.1.20 does NOT read `tsdown.config.ts`, emits `.mjs`/`.d.mts` defaults that mismatch the current consumer contract). Under engine-identity-only interpretation — which the maintainer explicitly chose in session-98 Q1 — the actual contract is Rolldown engine + ESM output + externalization + declaration emission. The wrapper is negotiable. Phased decomposition honors this interpretation: A2.1 closes the dispatch question via the existing `vp run build:ts` task; A2.2 retains the engine-swap question as a separable, deferrable concern.

**Alternatives considered**:

- **Single change with engine swap to `vp pack`**: rejected. Would force consumer-contract churn (`.js`→`.mjs`, `.d.ts`→`.d.mts` updates to `package.json exports.*` paths across all published packages) on alpha-stage software. Maintainer's Q2 motivation was "Close vp-arc to 7/7", not "Eliminate tsdown specifically".
- **Defer A2 entirely (Option C from session 97)**: rejected. Leaves the vp-arc at 6/7 indefinitely; the dispatch-rebind work is already done (vp run build:ts exists), so the slice's actual delta is light.
- **Empirical vp pack adoption with extension coercion (Option E from session 98 brainstorm)**: rejected. Optimizes for engine-swap at alpha-stage when the maintainer's stated motivation does not require it; takes on bundler-layer alpha-status risk for symbolic completion.

### Decision 2: A2.1 absorbs the stale-reference refresh that was previously deferred to A2.2

**Rationale**: The current spec text (`rolldown-build/spec.md:59`) says: "The reference refresh — updating the requirement text to enumerate the current package set ... SHALL be performed in the `migrate-build-to-vp-pack` follow-on policy change as part of the rebind." Under phased decomposition, A2.1 IS the rebind closure (line 154); deferring stale-reference refresh to A2.2 (engine swap, future, indefinite timeline) would leave the spec inconsistent until A2.2 ships. A2.1 absorbs the refresh as part of its dispatch-rebind closure.

**Alternatives considered**:

- **Keep refresh deferral text intact, refresh in A2.2**: rejected. A2.2 has no committed timeline; spec inconsistency would persist.
- **Refresh in a separate hygiene change**: rejected. Adds another openspec change for a 6-line text edit; defeats the cognitive-overhead-reduction value test.

### Decision 3: `migrate-build-to-vp-pack` retained as the named A2.2 future slice

**Rationale**: The maintainer's Q1 selection ("engine-identity only") opens the option to rename the future slice; the maintainer's Q3 selection (Approach 2 phased) explicitly keeps the named migration alive. Retaining the name preserves spec history and signals the engine-swap question is still on the table when vp pack matures.

**Alternatives considered**:

- **Rename A2.2 to `swap-build-engine-to-vp-pack`**: rejected. Adds rename churn for marginal naming-clarity gain.
- **Drop A2.2 entirely from spec text**: rejected. Removes the future engine-swap thread from spec context; would require a future change to re-introduce it.

### Decision 4: No edits to `orchestration-architecture/spec.md`

**Rationale**: Per the established vp-arc closure pattern, each slice closes on ITS OWN canonical spec. A1 (`migrate-test-to-vp-test`) closed on `bun-test/spec.md`. A3 (`resolve-clean-surface`) closed on `build-orchestration/spec.md`. A2.1 follows the pattern: closure on `rolldown-build/spec.md` only. The orchestration-architecture spec's slice list (lines 150-156) is a meta-statement about decomposition; it does not get edited per-slice.

### Decision 5: No `CLAUDE.md` edits

**Rationale**: The dispatch-convention statement already covers `build:*` tasks accurately ("vp run X is the canonical and only invocation path for every migrated tier (verify:_, build:_, hygiene)"). The Atomic Tiers table does not contain a `build:ts` row because it is not a verify tier. No edits needed.

## Risks / Trade-offs

**Risk 1**: Spec amendment may not reflect future engine-swap intent if A2.2 never ships.

- **Mitigation**: A2.1's amended Requirement "Binding to orchestration-architecture" explicitly names `migrate-build-to-vp-pack` as the future engine-swap thread. If the maintainer later decides engine-swap is not desired, the future slice can be archived as "obsolete" with appropriate spec adjustments at that point.

**Risk 2**: vp run dispatch overhead on `build:ts` may differ from direct `tsdown` invocation in edge cases.

- **Mitigation**: This dispatch already exists and was proven by 6 prior shipped slices. A2.1 introduces no new dispatch behavior. Post-archive `vp run verify` (fast gate) confirms the baseline holds.

**Risk 3**: The "rebind closure" language in the amended Requirement "Binding to orchestration-architecture" could be interpreted as foreclosing future engine-swap.

- **Mitigation**: The amendment text explicitly retains `migrate-build-to-vp-pack` as a future engine-swap policy slice. The closure is of the dispatch question, not the engine question.

## Migration Plan

The migration is reversible per the proposal's Risk Acceptance section. Order of operations within the change application:

1. **Pre-flight grounding** (§1 of tasks.md): capture current spec state.
2. **Spec MODIFIED apply** (§2): authored in this change's `specs/rolldown-build/spec.md` delta with 3 MODIFIED requirement blocks.
3. **Validation gate** (§3): `openspec validate rebind-build-dispatch-via-vp-run --strict`.
4. **Final state-sync** (§4): tick all tasks; status-confirm; archive.
5. **Post-archive verification** (§5): `openspec validate rolldown-build --strict` + `vp run verify` fast gate sanity check.

**Rollback strategy**: a single `git revert <merge-commit>` restores the 3 MODIFIED requirement blocks in `rolldown-build/spec.md` to their prior text. No code is touched, so no behavioral rollback is needed.

## Open Questions

None. The empirical probe of vp pack — sequenced AFTER A2.1 ships per maintainer's session-98 directive — runs independently and feeds A2.2's future design without blocking A2.1 closure.
