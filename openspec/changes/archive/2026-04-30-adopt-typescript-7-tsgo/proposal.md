## Why

TypeScript 7.0 (the native Go port, shipped as `@typescript/native-preview` with binary `tsgo`) entered public beta on 2026-04-21. Microsoft cites ~10x speedup vs TypeScript 6.0 for type-check workloads — the slowest stage of our inner-loop `verify` gate, which fans `tsc --noEmit` across seven active packages. Adopting `tsgo` for type-check buys real developer-loop time at low risk; the prerequisite TypeScript 5.8 → 6.x bump is unrelated debt that we would accumulate regardless.

Declaration emit is also adopted in this change (Phase C). The `microsoft/typescript-go` README now marks declaration emit "Done for TypeScript files" (in-progress for JavaScript, which we don't emit). A reusable parity gate at `scripts/verify/dts-parity.sh` was authored and run against the current source tree: every `.d.ts` divergence between `tsc` and `tsgo` falls into one of four categories — quote style (`'`/`"` swap), object-property ordering, generic alpha-renaming, type-alias eager expansion — all of which are no-op transformations on the type system (semantically identical). The single JSDoc-stripping divergence affects two sentences of internal documentation on a `private` method that consumers cannot call. With this evidence, we land both workloads on `tsgo` together rather than carrying a dual-implementation maintenance surface for two months waiting for TS 7.0 stable.

## What Changes

- **NEW**: introduces `tsgo` (`@typescript/native-preview`) as the canonical TypeScript implementation for both type-check AND declaration-emit workloads in this repository.
- TypeScript bumped from `5.8.3` to `6.x` at the root devDependency. Required because `tsgo`'s parity baseline is TS 6.0, not 5.x.
- Root `tsconfig.json` `moduleResolution: node` migrated to `bundler` (TS 6.0 removes `node|node10|classic`); `types: ["node", "bun"]` added (TS 6.0 default flip from auto-include to `[]`).
- Per-package `tsconfig.json` and `tsconfig.build.json` audited for TS 6.0 default flips: `strict:true`, `module:esnext`, `noUncheckedSideEffectImports:true`, `types:[]`, `rootDir:"./"`, `stableTypeOrdering:true`.
- `e2e/next-app/styles.d.ts` added with `declare module '*.css';` to satisfy `noUncheckedSideEffectImports: true` for Next's `import '../.animus/styles.css'`.
- Each active package's `compile` script swaps `tsc --noEmit` → `tsgo --noEmit` (Phase B).
- Each active package's `build:ts` script swaps `tsdown && tsc -p tsconfig.build.json` → `tsdown && tsgo -p tsconfig.build.json` (Phase C).
- `scripts/verify/types.sh` swaps `tsc -p ...` → `tsgo -p ...`.
- `scripts/verify/_preconditions.sh::require_bun_install` updated to probe the type-check implementation binary via `TYPECHECK_BINARY` shell variable (single source-of-truth indirection).
- `scripts/verify/dts-parity.sh` added — reusable declaration-emit parity gate comparing tsc and tsgo `.d.ts` output across all publishable packages.
- Soak: a parallel `verify:compile:tsc-fallback` script preserves the original `tsc`-based type-check path for ad-hoc parity checks during the soak window. The `typescript@6.0.3` package remains installed for the duration of the soak to back the fallback.
- **OUT OF SCOPE**: `--watch` (not in beta), tsdown's experimental `tsgo` opt-in in `rolldown-plugin-dts`, and Corsa programmatic API are all explicitly deferred.
- **BREAKING (internal)**: `compile` and `build:ts` script invocations in package.json files change from `tsc` to `tsgo`. CI and local environments must have `@typescript/native-preview` installed; `bun install` covers this once the devDependency lands.

## Capabilities

### New Capabilities
- `typescript-toolchain`: Establishes the canonical TypeScript implementation policy for the repository — which compiler family runs which workload (type-check vs declaration emit), pinned version surface, and install-location convention. This becomes the single place where future TS-toolchain decisions (e.g., adopting `tsgo` for declaration emit when 7.0 stable lands) are described.

### Modified Capabilities
- `verification-tier-policy`: The `require_bun_install` helper requirement currently probes `node_modules/.bin/tsc` as the install-validity check. Once `tsgo` is the canonical type-check implementation, this probe MUST target the type-check binary in use. The helper's contract becomes "fails loud if the canonical type-check binary is missing," not "fails loud if `tsc` is missing." The change is small but is genuinely spec-level because the existing scenario "Tier script sources the helper" pins behavior on the helper's binary probe.

## Impact

**Affected code**:
- Root `package.json` (devDependencies: `typescript`, `@typescript/native-preview`).
- Root `tsconfig.json` (`moduleResolution`).
- Per-package `tsconfig.json` and `tsconfig.build.json` for: `system`, `properties`, `_assertions`, `extract`, `vite-plugin`, `next-plugin`, `test-ds`, `_integration`, `showcase`. Plus `e2e/next-app/tsconfig.json` and `e2e/vite-app/tsconfig.json`. Plus `packages/system/__tests__/tsconfig.test-d.json`.
- Per-package `package.json` `scripts.compile` for the seven active TS packages plus `showcase`.
- `scripts/verify/types.sh`.
- `scripts/verify/_preconditions.sh::require_bun_install`.
- Root `CLAUDE.md` Cache Tiers / Debugging Decision Tree if new failure modes surface during soak.

**Dependencies**:
- `typescript`: `5.8.3` → `6.x`.
- `@typescript/native-preview`: pinned exact-version (no `^` or `~`).

**Out-of-tree systems**:
- CI: no workflow change required (CI runs `bun install` then `bun run verify:*`; the toolchain change is fully captured by package.json + script edits).
- knip: already supports `tsgo` as of v5.84.0 (PR webpro-nl/knip#1513, merged Feb 2026); our knip is 6.x. No knip config change anticipated, but the audit task verifies behavior with both `typescript` and `@typescript/native-preview` present in deps.
- tsdown: unaffected (`dts: false` in `tsdown.config.base.ts`; tsdown does not invoke `tsc` for declaration emit, it delegates to the standalone `tsc -p tsconfig.build.json` build leg, which stays on `tsc`).

**Risk surfaces**:
- TS 5→6 default flips may surface latent type errors. Phase A `verify:full` gate is the mitigation.
- `tsgo` blanket parity claim is broad; subtle inference differences could flip type-contract assertions in `packages/system/__tests__/*.test-d.ts`. The Phase B soak script (`verify:compile:tsc-fallback`) is the mitigation.
- Beta software in CI is real risk. Pinning exact version is the mitigation; reverting to the fallback script is the exit ramp.

**References**:
- TS 7.0 Beta announcement: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta/
- `microsoft/typescript-go` (feature table, CHANGES.md): https://github.com/microsoft/typescript-go
- `@typescript/native-preview` registry: https://registry.npmjs.org/@typescript/native-preview
- TS 6.0 announcement (5→6 migration source): https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- knip tsgo support PR: https://github.com/webpro-nl/knip/pull/1513
- tsdown dts docs: https://tsdown.dev/options/dts
