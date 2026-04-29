## 1. Phase A — TypeScript 5.8.3 → 6.x (Prerequisite)

- [ ] 1.1 Bump root `package.json` `devDependencies.typescript` from `5.8.3` to the latest published TS 6.x exact version. Run `bun install` to materialize.
- [ ] 1.2 Update root `tsconfig.json`: change `moduleResolution: node` to `moduleResolution: bundler`. Verify `target`, `module`, `strict`, `declaration`, `sourceMap` are valid under TS 6.0.
- [ ] 1.3 Audit `packages/system/tsconfig.json` and `packages/system/tsconfig.build.json` for TS 6.0 removed flags (`target:es5`, `module:amd|umd|systemjs`, `baseUrl`, `moduleResolution:node|node10|classic`) and changed defaults (`strict`, `module`, `noUncheckedSideEffectImports`, `types`, `rootDir`, `stableTypeOrdering`).
- [ ] 1.4 Audit `packages/properties/tsconfig.json` and `packages/properties/tsconfig.build.json` (same surfaces).
- [ ] 1.5 Audit `packages/_assertions/tsconfig.json` and `packages/_assertions/tsconfig.build.json`.
- [ ] 1.6 Audit `packages/extract/tsconfig.json` and `packages/extract/tsconfig.build.json`.
- [ ] 1.7 Audit `packages/vite-plugin/tsconfig.json` and `packages/vite-plugin/tsconfig.build.json`.
- [ ] 1.8 Audit `packages/next-plugin/tsconfig.json` and `packages/next-plugin/tsconfig.build.json`.
- [ ] 1.9 Audit `packages/test-ds/tsconfig.json` and `packages/test-ds/tsconfig.build.json`.
- [ ] 1.10 Audit `packages/_integration/tsconfig.json`.
- [ ] 1.11 Audit `packages/showcase/tsconfig.json`.
- [ ] 1.12 Audit `packages/system/__tests__/tsconfig.test-d.json`.
- [ ] 1.13 Audit `e2e/next-app/tsconfig.json` and `e2e/vite-app/tsconfig.json`.
- [ ] 1.14 Run `bun run verify:full`. If type errors surface from default flips, fix at root cause (do not suppress without explicit rationale captured in commit body).
- [ ] 1.15 Run `bun run hygiene` and resolve any drift introduced by the audit. Confirm verdict is `converged` or `cap-hit-clean`.
- [ ] 1.16 Phase A commit boundary: stage tsconfig changes + `package.json` typescript bump + any fix-forward edits as one logical commit (or a small commit series if cleaner).

## 2. Phase B — Adopt `tsgo` for Type-Check

- [ ] 2.1 Add `@typescript/native-preview` to root `package.json` `devDependencies` at exact pinned version (current beta: `7.0.0-dev.20260421.2` or whichever exact version is current at implementation time — no `^`, `~`, or floating dist-tag). Run `bun install`.
- [ ] 2.2 Update `scripts/verify/_preconditions.sh::require_bun_install` to probe `node_modules/.bin/tsgo` (the canonical type-check binary) instead of `node_modules/.bin/tsc`. Update the error message to name `tsgo`. Maintain the helper-not-hard-coded contract per the modified `verification-tier-policy` spec — define the binary name as a single shell variable at the top of the helper or equivalent.
- [ ] 2.3 Update `packages/system/package.json` `scripts.compile` from `tsc --noEmit` to `tsgo --noEmit`.
- [ ] 2.4 Update `packages/properties/package.json` `scripts.compile` from `tsc --noEmit` to `tsgo --noEmit`.
- [ ] 2.5 Update `packages/_assertions/package.json` `scripts.compile` from `tsc --noEmit` to `tsgo --noEmit`.
- [ ] 2.6 Update `packages/extract/package.json` `scripts.compile` from `tsc --noEmit` to `tsgo --noEmit`.
- [ ] 2.7 Update `packages/vite-plugin/package.json` `scripts.compile` from `tsc --noEmit` to `tsgo --noEmit`.
- [ ] 2.8 Update `packages/next-plugin/package.json` `scripts.compile` from `tsc --noEmit` to `tsgo --noEmit`.
- [ ] 2.9 Update `packages/test-ds/package.json` `scripts.compile` from `tsc --noEmit` to `tsgo --noEmit`.
- [ ] 2.10 Update `packages/_integration/package.json` `scripts.compile` (if present and using tsc) and `packages/showcase/package.json` `scripts.compile` to `tsgo --noEmit`.
- [ ] 2.11 Update `scripts/verify/types.sh`: replace `node_modules/.bin/tsc -p packages/system/__tests__/tsconfig.test-d.json --noEmit` with `node_modules/.bin/tsgo -p packages/system/__tests__/tsconfig.test-d.json --noEmit`.
- [ ] 2.12 Add a `compile:tsc-fallback` script in EACH active TS package's `package.json` (the same packages touched in 2.3–2.10), preserving the original `tsc --noEmit` invocation verbatim. This is the per-package fallback per the `typescript-toolchain` "Soak Path for Type-Check Implementation Swaps" requirement.
- [ ] 2.13 Add a root `package.json` `scripts.verify:compile:tsc-fallback`: `bun run --filter './packages/*' compile:tsc-fallback`. Confirm this script is NOT referenced by any composite orchestrator (`verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`).
- [ ] 2.14 Run `bun run verify:full`. Confirm green.
- [ ] 2.15 Run `bun run verify:compile:tsc-fallback`. Confirm pass/fail outcome is identical to the `tsgo`-based `verify:compile` from 2.14. Any divergence MUST be triaged before landing — file an issue at `microsoft/typescript-go` with a minimal repro and attach commit hash + tsgo version.
- [ ] 2.16 knip behavior verification: with both `typescript` and `@typescript/native-preview` in deps, run `bun run hygiene`. Compare the receipts in `.hygiene/receipts.jsonl` against the prior-baseline receipts (from the Phase A commit's hygiene run). Investigate any new findings flagged at `D` or `D1` layers; the official knip TS plugin docs (https://knip.dev/reference/plugins/typescript) confirm both binaries are recognized.
- [ ] 2.17 Phase B commit boundary: stage Phase B edits as one logical commit (or a small commit series — script edits + dep add can be one commit; fallback-script add can be a second).

## 3. Documentation Updates

- [ ] 3.1 Update root `CLAUDE.md` Monorepo Build System section: document the canonical type-check vs declaration-emit implementation split per the `typescript-toolchain` "Workload Split Documentation" requirement. Include for each implementation: the install command (in `bun add -d <pkg>` form) and the exact pinned version.
- [ ] 3.2 If new failure modes surface during Phase B verification (e.g., a `tsgo`-specific error class), add a row to root `CLAUDE.md` Debugging Decision Tree.
- [ ] 3.3 Confirm root `CLAUDE.md` Verification Tier Table still accurately describes `verify:compile` and `verify:types` upstream requirements and fail-loud triggers — update only if the implementation swap changes the tier's contract surface (it should NOT, but verify).

## 4. Final Validation

- [ ] 4.1 Run `bun run verify:ci` to mirror the CI job order locally. Confirm green.
- [ ] 4.2 Run `bun run hygiene` end-to-end. Confirm verdict is `converged` or `cap-hit-clean` with no new `WARN` or `NOTE` lines vs the Phase A baseline (other than expected differences from added `compile:tsc-fallback` scripts being recognized as live by knip).
- [ ] 4.3 Run `openspec validate adopt-typescript-7-tsgo --strict`. Confirm validation passes.
- [ ] 4.4 Update `MEMORY.md` index with a session summary memory pointing at the proposal's resolved decisions on the four open questions.

## Deferred Work (NOT in this change)

The following items are explicitly out of scope and will be handled by separate future changes once their preconditions are met. They appear here for reviewer reference only.

- **Phase C (separate future change)**: Adopt `tsgo` for declaration emit (`tsc -p tsconfig.build.json` swap). Preconditions: TS 7.0 stable lands; the typescript-go feature table marks declaration emit "done"; a parity gate is established (per `typescript-toolchain` "Declaration Emit Implementation Selection" requirement). The future change will modify `typescript-toolchain` to name the new canonical declaration-emit implementation.

- **Soak fallback removal (separate follow-on commit)**: After the new canonical type-check implementation has been stable for at least one inner-loop cycle (one calendar week minimum), a follow-on commit removes the root `verify:compile:tsc-fallback` script AND the per-package `compile:tsc-fallback` scripts added in tasks 2.12–2.13. The follow-on commit also removes the `typescript@5.x` co-installed devDependency if no other workload depends on it.

- **`--watch` mode adoption**: Not in `tsgo` beta. Will be reconsidered when Microsoft ships the efficient `--watch` implementation per their public timeline.
