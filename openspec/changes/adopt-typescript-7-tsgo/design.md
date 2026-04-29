## Context

The repository currently runs TypeScript 5.8.3 across all workloads:
- **Type-check** (read-only): `verify:compile` fans `tsc --noEmit` across 7 active TS packages via `bun run --filter './packages/*' compile`. `verify:types` runs a single `tsc -p packages/system/__tests__/tsconfig.test-d.json --noEmit` for type-contract assertions.
- **Declaration emit** (write): each active package's `build:ts` script runs `tsdown && tsc -p tsconfig.build.json`. `tsdown` (configured with `dts: false` in `tsdown.config.base.ts`) emits `.js`/`.mjs` only; `tsc -p tsconfig.build.json` emits `.d.ts` via `emitDeclarationOnly: true`.
- The repo has NO composite builds and NO project references. Each package's tsc invocations are independent.

Microsoft published TypeScript 7.0 Beta on 2026-04-21 as `@typescript/native-preview` (binary: `tsgo`), citing ~10x speedup vs TypeScript 6.0 for type-check workloads. The parity baseline is TypeScript 6.0 — not 5.x — so a 5→6 bump is a hard prerequisite.

The typescript-go README marks declaration emit as "in progress" and CHANGES.md documents two recent parity bugs vs `tsc` (#972: declarations not emitted when type errors present; #989: class static literal type widening). For a library shipping `.d.ts` to npm consumers, this risk is material. Type-check (`--noEmit`) is covered by Microsoft's blanket parity statement and has no documented divergences.

knip (our hygiene Layer D dead-code detector) added `tsgo` support in v5.84.0 (PR webpro-nl/knip#1513, merged 2026-02). Our knip is 6.x — already covered. tsdown does not emit `.d.ts` (verified via `dts: false` in our base config); the experimental `tsgo` opt-in in `rolldown-plugin-dts` is not on our path.

## Goals / Non-Goals

**Goals:**
- Cross the TS 5.8 → 6.x boundary, paying that compiler-config debt as a clean prerequisite.
- Adopt `tsgo` (`@typescript/native-preview`) for type-check workloads only — `verify:compile`, `verify:types` — where the speedup is real and the risk is minimal.
- Preserve `.d.ts` emit stability: declaration emit stays on `tsc` until 7.0 stable lands.
- Establish a `typescript-toolchain` capability surface that future TS-toolchain decisions slot into (e.g., adopting `tsgo` for emit when 7.0 stable is green).
- Provide a soak window: a parallel `verify:compile:tsc-fallback` script that runs the original `tsc`-based path for ad-hoc parity checks, deletable once `tsgo` proves stable in CI.

**Non-Goals:**
- Declaration emit via `tsgo`. Deferred to a future change once the typescript-go feature table marks declaration emit "done" AND we can run a downstream-consumer build verification (e2e fixtures + showcase) byte-equal against the `tsc` baseline.
- `--watch` mode. Not in `tsgo` beta; we don't depend on `tsc --watch` in any verify tier or CI pipeline.
- tsdown's experimental `tsgo` declaration-emit opt-in (`rolldown-plugin-dts`'s `tsgo: true`). Their docs label it "not yet recommended for production."
- The Corsa programmatic API. We don't consume TypeScript's programmatic API in any pipeline.
- Mass refactor of tsconfigs beyond TS 6.0 compatibility. Phase A audits for breakage only; behavior changes that could be done are explicitly NOT in scope.

## Decisions

### D1: Phase A is prerequisite, not optional
- **Choice**: TS 5.8.3 → 6.x lands as Phase A before any `tsgo` adoption.
- **Why**: Microsoft's parity claim is "tsgo behaves identically to TypeScript 6.0," not 5.x. Skipping the 5→6 bump leaves us in a state where any tsgo-vs-tsc divergence cannot be cleanly attributed to either the TS-version change or the compiler-engine change. Phase A is also independent debt: TS 5.8 was the last 5.x release, and 5.x will reach EOL on Microsoft's standard cadence.
- **Alternatives considered**: Skip 5→6 and pin `@typescript/native-preview` while keeping `typescript@5.8.3`. Rejected because tsgo's behavioral parity is not specified vs 5.x; we'd be in undefined territory.

### D2: Single openspec change with phased tasks
- **Choice**: Phase A and Phase B both live in this change; tasks are clearly separable.
- **Why**: The user explicitly framed this as "the change" (singular). Bundled review surface is one document, one validation pass, one archive event.
- **Alternatives considered**: Split into `migrate-typescript-6` (prereq) + `adopt-tsgo-typecheck`. Cleaner blast separation; if Phase B is reverted, Phase A stays. Surfaced as Open Question Q1 — happy to split if reviewer disagrees.

### D3: `bundler` over `node16` for root `moduleResolution`
- **Choice**: Root `tsconfig.json` `moduleResolution` migrates from `node` to `bundler`.
- **Why**: Existing per-package `tsconfig.json` files for `system`, `vite-plugin`, `next-plugin`, `_assertions`, `test-ds`, `showcase`, `e2e/next-app`, `e2e/vite-app` already use `bundler`. The root inheriting `bundler` matches actual repo practice and our consumer story (Vite + Next + tsdown — all bundler-class consumers). `node16` would be the Node-aligned answer but doesn't match how our packages actually resolve.
- **Alternatives considered**: `node16`. Rejected as inconsistent with established per-package convention.

### D4: Soak window via `verify:compile:tsc-fallback` script
- **Choice**: Phase B adds a parallel script that runs the original `tsc`-based type-check, available for ad-hoc parity checks. The script remains in the repo for one verified-stable cycle, then is removed in a follow-on commit.
- **Why**: `tsgo` is beta software. A side-by-side comparison capability lets us catch tsgo-vs-tsc divergence in real-world type-contract tests (`packages/system/__tests__/*.test-d.ts`) without committing to a full revert. The script is cheap; its cost is one entry in the package.json and one well-named alias.
- **Alternatives considered**: Hard cutover (no fallback). Rejected as inappropriate for beta software in a CI gate.

### D5: Pin `@typescript/native-preview` to exact version
- **Choice**: `devDependencies` declares `"@typescript/native-preview": "7.0.0-dev.<exact>"` with no `^` or `~`.
- **Why**: Beta dist-tags (`beta`, `next`) move under us. An exact pin makes upgrades deliberate; a regression in a new beta tag cannot silently flow into our CI on a `bun install`.
- **Alternatives considered**: Range pin (`^7.0.0-dev.0`). Rejected because beta versioning semantics are not stable.

### D6: Modify `verification-tier-policy` rather than introduce a new helper
- **Choice**: The `require_bun_install` helper's binary probe migrates from `node_modules/.bin/tsc` to the canonical type-check binary designated by the `typescript-toolchain` capability.
- **Why**: The helper's contract is "fail loud if `bun install` hasn't been run." That contract is preserved; only the probe-target updates. A new helper (e.g., `require_typecheck_binary`) would duplicate the contract.
- **Alternatives considered**: Add a parallel helper for the new binary. Rejected as duplication; the existing helper's purpose is correct.

## Risks / Trade-offs

[Risk] TS 5→6 default flips surface latent type errors at audit time.
→ **Mitigation**: Phase A audit task explicitly enumerates the default-flip surfaces (`strict`, `module`, `noUncheckedSideEffectImports`, `types`, `rootDir`, `stableTypeOrdering`); `verify:full` is the landing gate. If errors surface, they are real bugs that 5.8.3 was permissive about — fix-or-explicit-suppress at audit time, not deferred.

[Risk] `tsgo` blanket parity claim is broad. Subtle inference differences could flip type-contract assertions in `packages/system/__tests__/*.test-d.ts`.
→ **Mitigation**: Phase B soak script (`verify:compile:tsc-fallback`) preserves the `tsc`-based path for parallel runs. If type-contract assertions flip, we have an immediate diff between the two implementations. The fallback stays available for at least one full inner-loop cycle before removal.

[Risk] Beta software in CI = real flakiness or crash risk.
→ **Mitigation**: Exact-version pin (no range); fallback script provides emergency revert. CI failures attributable to `tsgo` itself can be triaged by re-running with the fallback to confirm.

[Risk] knip activates its TypeScript plugin when EITHER `typescript` OR `@typescript/native-preview` is in deps. With both present, behavior could differ vs. either alone.
→ **Mitigation**: Phase B audit task includes a knip behavior verification step — run knip with both deps present and confirm output is consistent with the prior-baseline knip run. The official knip TS plugin docs (https://knip.dev/reference/plugins/typescript) confirm the plugin parses CLI arguments for both `tsc` and `tsgo` binaries.

[Risk] `tsgo` may emit different inference types in non-trivial generic computations vs `tsc 6.x`. Even though `--noEmit` doesn't emit, type-test assertions read inference output.
→ **Mitigation**: Type-contract assertions in `packages/system/__tests__/*.test-d.ts` are the soak ground-truth. If `tsgo` flips an assertion vs `tsc`, that's the soak signal — file an upstream issue at `microsoft/typescript-go` and either suppress on our side or revert via the fallback.

[Trade-off] Adopting beta software for type-check buys ~10x speedup but carries an ongoing maintenance attention surface. We must monitor `microsoft/typescript-go` releases during the beta window.
→ **Acceptance**: This is a deliberate trade. The ROI on inner-loop speedup is meaningful; the maintenance attention is bounded by the 7.0 stable timeline (Microsoft's blog signals "in coming weeks/months").

## Migration Plan

**Phase A — TypeScript 5.8.3 → 6.x**

1. Update root `package.json` `devDependencies.typescript` to the latest published TS 6.x.
2. Update root `tsconfig.json`: `moduleResolution: node` → `bundler`.
3. Audit each tsconfig file for removed flags and changed defaults. Files to audit:
   - `packages/system/tsconfig.json`, `packages/system/tsconfig.build.json`
   - `packages/properties/tsconfig.json`, `packages/properties/tsconfig.build.json`
   - `packages/_assertions/tsconfig.json`, `packages/_assertions/tsconfig.build.json`
   - `packages/extract/tsconfig.json`, `packages/extract/tsconfig.build.json`
   - `packages/vite-plugin/tsconfig.json`, `packages/vite-plugin/tsconfig.build.json`
   - `packages/next-plugin/tsconfig.json`, `packages/next-plugin/tsconfig.build.json`
   - `packages/test-ds/tsconfig.json`, `packages/test-ds/tsconfig.build.json`
   - `packages/_integration/tsconfig.json`
   - `packages/showcase/tsconfig.json`
   - `packages/system/__tests__/tsconfig.test-d.json`
   - `e2e/next-app/tsconfig.json`
   - `e2e/vite-app/tsconfig.json`
4. Run `bun run verify:full`. If type errors surface, fix at root cause; do not suppress without explicit rationale.
5. Land Phase A.

**Phase B — `tsgo` for type-check**

1. Add `@typescript/native-preview` to root `devDependencies` at exact pinned version.
2. Update each active TS package's `compile` script: `tsc --noEmit` → `tsgo --noEmit`. Packages: `system`, `properties`, `_assertions`, `extract`, `vite-plugin`, `next-plugin`, `test-ds`, plus `showcase` and `_integration` (which also use `tsc --noEmit`).
3. Update `scripts/verify/types.sh`: replace `node_modules/.bin/tsc -p ...` with `node_modules/.bin/tsgo -p ...`.
4. Update `scripts/verify/_preconditions.sh::require_bun_install`: probe `node_modules/.bin/tsgo` instead of `node_modules/.bin/tsc`.
5. Add a `verify:compile:tsc-fallback` script at root: `bun run --filter './packages/*' compile:tsc-fallback`. Each per-package script preserves the original `tsc --noEmit` invocation.
6. Run `bun run verify:full`. Compare results against `bun run verify:compile:tsc-fallback`. Both MUST produce identical pass/fail.
7. Update root `CLAUDE.md` Monorepo Build System section to document the canonical type-check vs declaration-emit implementation split.
8. Land Phase B.

**Soak — post-Phase B**

- For at least one inner-loop cycle (one calendar week minimum), `verify:compile:tsc-fallback` remains available.
- If divergence surfaces, file an upstream issue at `microsoft/typescript-go` with reproducer.
- Once stable, follow-on commit removes `verify:compile:tsc-fallback` and the `compile:tsc-fallback` per-package scripts.

**Rollback strategy**

- Phase A revert: revert the TS version bump and root `tsconfig.json` change. All packages should still type-check (TS 6 is a strict superset for our config surface).
- Phase B revert: revert the `compile` and `verify:types` script edits; remove `@typescript/native-preview` devDependency. The fallback script proves the `tsc`-based path still works at the moment of revert.

## Open Questions

1. **Bundle vs split**: Should this remain one openspec change or split into `migrate-typescript-6` (Phase A only) + `adopt-tsgo-typecheck` (Phase B only)? My recommendation is split — Phase A is independent debt — but the user framed this as "the change" (singular). Awaiting reviewer decision; if split, the spec deltas in this proposal break cleanly along the phase boundary.
2. **Root `moduleResolution`**: Decision D3 recommends `bundler`. Reviewer may prefer `node16` for Node-tooling alignment (e.g., scripts/ would resolve modules under bundler conditions, which may surprise contributors).
3. **Soak duration**: The migration plan says "at least one inner-loop cycle / one calendar week." Reviewer may prefer a longer soak (e.g., one full release cycle) before removing the fallback.
4. **Workspace-level pinning**: `typescript` currently lives at root devDependencies (hoisted). Should `@typescript/native-preview` follow the same pattern (root-only) or be installed per-workspace? Hoisted is the existing convention; deviating requires rationale.
5. **Future Phase C scope**: When 7.0 stable lands, the Phase C change (tsgo for declaration emit) needs a parity gate. Should the gate be (a) byte-equal `.d.ts` snapshot test across all packages, or (b) downstream consumer build (e2e + showcase) byte-equal against `tsc` baseline? Both require new infrastructure; (b) is more end-to-end honest but more expensive to implement.
