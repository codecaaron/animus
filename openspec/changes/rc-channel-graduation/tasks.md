## 1. Design Review (gate before Phase 3 — Phases 1–2 may proceed)

D5 and D6 are closed by the 2026-04-16 review (see `design.md`). Remaining open decisions:

- [ ] 1.1 Resolve D7 merge strategy for `next` → `main`: fast-forward vs. squash vs. merge commit. Document decision in runbook.
- [ ] 1.2 Resolve D8 CHANGELOG mechanism: reset vs. append vs. auto-gen.
- [ ] 1.3 Resolve D9 `latest` dist-tag policy during RC: retarget at current RC vs. leave stale.
- [ ] 1.4 Resolve D10 stabilization window strictness and duration.

## 2. Pre-RC Idiomacy — `includes()` relocation

- [x] 2.1 Modify `createSystem()` at `packages/system/src/SystemBuilder.ts` to accept optional `{ includes?: readonly SystemInstance[] }` constructor arg. Retain the value on the builder for introspection. Runtime remains no-op (correct).
- [x] 2.2 Remove the `includes()` chain method from `SystemBuilder` (currently at `packages/system/src/SystemBuilder.ts:140-148`).
- [x] 2.3 Update `packages/extract/pipeline/discover-packages.ts` regex parser to recognize the constructor-arg pattern `createSystem(\s*\{[^}]*includes\s*:\s*\[([^\]]*)\]`. During the RC iteration window, also retain the legacy `.includes([...])` pattern as a fallback.
- [x] 2.4 Migrate `packages/showcase/src/ds.ts:647` from `.includes([testDs])` chain form to `createSystem({ includes: [testDs] })` constructor form. Move the `createSystem` call to the top of the builder chain with the new argument.
- [x] 2.5 Search for any other live call sites of `.includes([...])` across `packages/**` and `e2e/**` and migrate them.
- [x] 2.6 Update any MDX in `packages/showcase/src/content/**` that documents the prior `includes()` shape.
- [x] 2.7 Run `bun run verify:compile && bun run verify:types && bun run verify:unit:ts` per root CLAUDE.md change-type map for `packages/system/src/**` edits. Additionally run `bun run verify:showcase` and `bun run verify:integration` because `discover-packages.ts` change affects the extraction pipeline. **Result:** compile ✓ types ✓ unit:ts ✓ (123/123) integration ✓ (110/110) showcase ✓ next ✓ vite ✓
- [x] 2.8 Add a test in `packages/extract/tests/` or `packages/_integration/__tests__/` that verifies constructor-arg pattern discovery matches chain-method-pattern discovery for the same set of identifiers.

## 3. Pre-RC Idiomacy — Keyframes Primitive

- [ ] 3.1 Implement `keyframes()` factory in `packages/system/src/keyframes.ts` (new file). Signature: `(frames: KeyframesMap) => KeyframesReference`. Return object shape: `{ __brand: 'Keyframes', frames, toString(): string, valueOf(): string }`.
- [ ] 3.2 Implement runtime content-hash name generation for `toString()`/`valueOf()` fallback. Use a stable hash (FNV-1a or similar) over `JSON.stringify(frames)`. Output format: `animus-kf-<hash>`.
- [ ] 3.3 Export `keyframes` from `@animus-ui/system` package index (`packages/system/src/index.ts`).
- [ ] 3.4 Widen `ThemedCSSProps` `animationName` slot to accept `KeyframesReference | string`. Verify with type tests in `packages/system/__tests__/` and `verify:types`.
- [ ] 3.5 Extend the Rust extractor (`packages/extract/src/`) to recognize `keyframes()` calls when walking the system module. When encountered as a named export binding, generate an extraction-time name derived from the binding plus a content hash (e.g., `animus-kf-fadeIn-<hash>`), and emit the `@keyframes` block into `@layer global`.
- [ ] 3.6 Extend the extractor to substitute `animationName: <binding>` references in component styles with the extraction-time keyframes name when the binding resolves to a `keyframes()` return.
- [ ] 3.7 Wire brand-based discovery in the Vite plugin: extend the existing `GlobalStyleBlock` named-export scan to also collect `__brand === 'Keyframes'` exports. Pass them to the extraction pipeline for emission.
- [ ] 3.8 Wire brand-based discovery in the Next plugin (`@animus-ui/next-plugin`) — parity with Vite.
- [ ] 3.9 Verify frame resolution parity — structured `@keyframes <name>` form and `keyframes()` primitive MUST produce identical CSS for the same frame map + theme. Add an integration test in `packages/_integration/__tests__/keyframes-parity.test.ts` asserting this.
- [ ] 3.10 Update `packages/showcase/src/content/architecture/global-styles.mdx` to demonstrate the primitive alongside the structured form. Include a worked example with `animationName: fadeIn` in a component.
- [ ] 3.11 Add a runtime smoke test in `packages/system/__tests__/keyframes.test.ts` exercising the factory return shape, string coercion, and brand check.
- [ ] 3.12 Run `bun run verify:compile && bun run verify:types && bun run verify:unit:ts && bun run verify:unit:rust && bun run verify:integration && bun run verify:showcase && bun run verify:vite && bun run verify:next` per change-type map (touches system, extract/Rust, vite-plugin, next-plugin, showcase, e2e/next-app).

## 4. Release-Workflow Hardening — `scripts/release.sh`

- [ ] 4.1 Add `bun run verify:ci` invocation after branch/cleanliness guards, before `parse_semver`. Exit non-zero if it fails without touching git state.
- [ ] 4.2 Skip the verify gate under `--dry-run`.
- [ ] 4.3 Implement stale-channel guard in `get_latest_tag`'s caller: when CURRENT has a prerelease identifier different from the requested `--channel` (or default `next`) AND bump type is `prepatch|preminor|premajor|prerelease`, exit with an error naming the channel drift.
- [ ] 4.4 Guard permits channel-agnostic bumps (`patch`, `minor`, `major`, `graduate`) without firing.
- [ ] 4.5 Guard permits explicit `--channel` flag matching CURRENT's channel.
- [ ] 4.6 Add unit-level bash tests or dry-run scenarios exercising the guard matrix (drift + unqualified, drift + explicit match, clean channel match, channel-agnostic bump).

## 5. CI Publish Pipeline — `.github/workflows/ci.yaml`

- [ ] 5.1 Replace the "contains hyphen → next" check at `.github/workflows/ci.yaml:180-184` with prerelease-identifier parsing. Extract the identifier from `VERSION` (the segment between `-` and `.` in `X.Y.Z-<id>.N`).
- [ ] 5.2 Set `TAG` to the extracted identifier; default to `latest` when no prerelease identifier is present.
- [ ] 5.3 Add explicit CI smoke-test scenarios in workflow comments covering: stable → `latest`, `-rc.N` → `rc`, `-next.N` → `next`, `-beta.N` → `beta`.
- [ ] 5.4 Validate the CI change on a throwaway tag against a private npm registry OR a dry-run publish before cutting the real `rc.0`.

## 6. Runbook — `docs/release-runbook.md` (or equivalent)

- [ ] 6.1 Create the runbook document at the location agreed in D4. Reference it from the root `README.md`.
- [ ] 6.2 Write the "cut initial RC" flow: commands, verification checkpoints, expected observables, recovery actions. Align with `rc-graduation-runbook` spec Scenario "Cut-RC command sequence".
- [ ] 6.3 Write the "iterate RC" flow: breaking-change CHANGELOG requirements, command sequence, dist-tag verification.
- [ ] 6.4 Write the "graduate" flow: command sequence, `latest`-reclamation verification, stabilization-window announcement template.
- [ ] 6.5 Write the rollback-paths section: non-destructive forward-fix patterns for failed publishes, dist-tag corrections via `npm dist-tag add`.
- [ ] 6.6 Document the stabilization-window commitment (from D10 resolution) explicitly in the graduate flow.

## 7. CHANGELOG

- [ ] 7.1 Apply D8 decision: reset the dead 2022 `CHANGELOG.md` OR wire conventional-commit tooling OR establish an append convention.
- [ ] 7.2 Write the CHANGELOG entry for `1.0.0-rc.0` covering the public surface at freeze time. Include the 5-persona audit findings and positioning statement.

## 8. Merge `next` → `main`

- [ ] 8.1 Apply D7 merge-strategy decision. Execute the merge (manual or via PR per decision).
- [ ] 8.2 Verify `main` contains the full `next` surface post-merge. Run `bun run verify:ci` on `main`.
- [ ] 8.3 Confirm `scripts/release.sh` passes branch-guard on the merged `main`.

## 9. Cut `1.0.0-rc.0`

- [ ] 9.1 Follow the runbook's cut-RC flow end-to-end.
- [ ] 9.2 Verify CI publishes all 5 packages (+ NAPI platform subpackages) with `--tag rc`.
- [ ] 9.3 Verify `npm view @animus-ui/system dist-tags` shows `rc: 1.0.0-rc.0`.
- [ ] 9.4 Smoke-test external install: in a scratch directory, `npm install @animus-ui/system@rc` and confirm the RC version is installed.
- [ ] 9.5 Apply D9 `latest` dist-tag decision (retarget or leave stale).

## 10. Documentation & Evangelism Kit

- [ ] 10.1 Update `packages/showcase/src/content/introduction.mdx` with the RC installation instructions (`npm install @animus-ui/system@rc` or equivalent per D9).
- [ ] 10.2 Author a short evangelism-ready positioning document (blog post draft, README section, or Twitter thread outline) using the 5-persona audit statements.

## 11. RC Iteration Loop (post-rc.0)

- [ ] 11.1 For each MVP concern raised during evangelism, create a scoped openspec change and apply via the runbook's iterate-RC flow.
- [ ] 11.2 Each iteration updates CHANGELOG and publishes via `bun release prerelease --channel rc`.
- [ ] 11.3 Track iteration log (externally or in a dedicated file) to inform graduation readiness.

## 12. Graduation

- [ ] 12.1 When MVP concerns are exhausted, follow the runbook's graduate flow.
- [ ] 12.2 Run `bun release graduate` on `main`.
- [ ] 12.3 Verify CI publishes with `--tag latest`, auto-reclaiming from the ancient `0.1.0-next.1` pointer.
- [ ] 12.4 Announce `1.0.0` release and stabilization-window commitment (per D10).

## 13. Archive and sync

- [ ] 13.1 Once 12.4 is complete and verified, archive this change via `/opsx:archive rc-channel-graduation`.
- [ ] 13.2 Sync capability specs: ensure `openspec/specs/release-workflow/spec.md` reflects MODIFIED + ADDED requirements from this change. Ensure `openspec/specs/rc-graduation-runbook/spec.md` exists post-archive.
- [ ] 13.3 Update project memory with graduation outcome and stabilization commitment.
