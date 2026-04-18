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

> **REFINEMENT 2026-04-17:** D6 was refined after a 5-persona external panel review + user-invoked KWATZ. The shape ships in a single-branded-block form (tasks 3.1–3.12 below) was superseded by a branded **collection** of typed `KeyframeRef`s per named keyframe. Task 3.6 (extraction-time binding substitution) moves from deferred to IN SCOPE. Frame body vocabulary narrows to CSS + `{scale.key}` token refs (no bare scale keys). Tasks 3.1–3.12 below document what shipped under the old shape and require refactoring; refinement tasks 3.13+ capture the remaining work.

### 3A. Shipped under old single-block shape (SUPERSEDED — refactor required per 3B)

- [x] 3.1 Implement `keyframes()` factory in `packages/system/src/keyframes.ts` (new file). Signature: `(frames: KeyframesMap) => KeyframesReference`. Return object shape: `{ __brand: 'Keyframes', frames, toString(): string, valueOf(): string }`.
- [x] 3.2 Implement runtime content-hash name generation for `toString()`/`valueOf()` fallback. Use a stable hash (FNV-1a or similar) over `JSON.stringify(frames)`. Output format: `animus-kf-<hash>`.
- [x] 3.3 Export `keyframes` from `@animus-ui/system` package index (`packages/system/src/index.ts`).
- [ ] 3.4 Widen `ThemedCSSProps` `animationName` slot to accept `KeyframesReference | string`. Verify with type tests in `packages/system/__tests__/` and `verify:types`. **DEFERRED to post-RC-0 iteration.** Usage pattern for RC.0: `animationName: fadeIn.name` or template-literal coercion. Documented in MDX.
- [x] 3.5 Extend the Rust extractor (`packages/extract/src/`) to recognize `keyframes()` calls when walking the system module. **Shipped via plugin brand discovery** — `system_loader.rs::extract_keyframes_blocks` iterates module exports, checks `__brand === 'Keyframes'`, serializes `{ name, frames }` via rquickjs JSON.stringify. `theme_resolver.rs::resolve_all_keyframes_blocks` emits `@keyframes <name> { ... }` blocks into the `@layer global` output. Extraction-time binding-aware names are not needed — the runtime hash (computed by the factory) is the authoritative name and flows through both paths.
- [ ] 3.6 Extend the extractor to substitute `animationName: <binding>` references in component styles with the extraction-time keyframes name when the binding resolves to a `keyframes()` return. **DEFERRED to post-RC-0 iteration.** For RC.0 the runtime dynamic-style path resolves `animationName: fadeIn.name` via `toString()` coercion at render — the DOM receives the correct hash name. Extraction-time substitution would be a per-component-style optimization.
- [x] 3.7 Wire brand-based discovery in the Vite plugin: extend the existing `GlobalStyleBlock` named-export scan to also collect `__brand === 'Keyframes'` exports. Pass them to the extraction pipeline for emission. **Shipped** — `packages/vite-plugin/src/index.ts` stores `keyframesBlocksJson` from `loadSystemModule` and forwards to `analyzeProject` as the 14th argument.
- [x] 3.8 Wire brand-based discovery in the Next plugin (`@animus-ui/next-plugin`) — parity with Vite. **Shipped** — `packages/next-plugin/src/plugin.ts` mirrors the Vite wiring at both `analyzeProject` call sites (full pipeline + HMR path).
- [x] 3.9 Verify frame resolution parity — structured `@keyframes <name>` form and `keyframes()` primitive MUST produce identical CSS for the same frame map + theme. Added `packages/_integration/__tests__/keyframes-parity.test.ts` — 5 tests all pass (including frame-body equivalence after name normalization).
- [x] 3.10 Update `packages/showcase/src/content/architecture/global-styles.mdx` to demonstrate the primitive alongside the structured form. Include a worked example with `animationName: fadeIn` in a component.
- [x] 3.11 Add a runtime smoke test in `packages/system/__tests__/keyframes.test.ts` exercising the factory return shape, string coercion, and brand check. 10/10 pass.
- [x] 3.12 Run full verify sweep. **Result:** fast-gate (lint + compile + types + unit:ts + unit:rust + canary) ✓ — Rust 254 ✓, canary 197 ✓ (+4 snapshots), TS unit 123 ✓. Integration 115/115 ✓ (added keyframes-parity + discover-packages). Showcase ✓. Vite ✓. Next ✓.

### 3B. Refinement tasks — collection-of-refs shape + binding substitution (IN SCOPE per D6 2026-04-17)

- [x] 3.13 Refactor `packages/system/src/keyframes.ts` from single-branded-block shape to **collection factory**. Signature: `<Map extends Record<string, KeyframeFrameMap>>(map: Map) => Keyframes<Map>`. Return shape: `{ __brand: 'Keyframes', __frames: { [K]: { name, frames } } } & { [K]: KeyframeRef<K> }`. Per-key names authored via FNV-1a over frame body (`animus-kf-<hash>`); identical frame bodies dedupe naturally. **Shipped.**
- [x] 3.14 Update `packages/system/src/index.ts` exports: `keyframes` factory + `KeyframeRef`/`Keyframes`/`KeyframeFrameMap` types. Legacy `KeyframesReference`/`KeyframesMap`/`KeyframeFrameValue` names removed (zero npm consumers — no back-compat bridge needed). **Shipped.**
- [x] 3.15 Widen `ThemedCSSProps.animationName` to accept `KeyframeRef<string>` alongside `PropertyTypes['animationName']`. Implemented via conditional in the mapped type (config.ts:190+). `verify:types` ✓. Template-literal shorthand type validation intentionally skipped per TS Specialist panel review. **Shipped.**
- [x] 3.16 Update `packages/extract/src/system_loader.rs::extract_keyframes_blocks` to emit the full `__frames` record per collection. JSON payload shape now: `{ exportName: { keyName: { name, frames } } }` (nested). `theme_resolver::resolve_all_keyframes_blocks` updated to walk the nested shape and emit one `@keyframes <name>` per named key; `resolve_keyframes_block` (per-block) unchanged. **Shipped.**
- [x] 3.17 Extraction-time binding substitution in the Rust extractor (was 3.6, deferred). Registry built once at `project_analyzer::analyze` entry from `keyframes_blocks_json`; injected into per-file `resolved_static_values` map via existing binding-resolution rail (cross-file imports + same-file local exports). `style_evaluator::eval_expression_with_statics` now resolves `Identifier.property` MemberExpressions against the map. Unknown keys + unknown collections fall through to the existing skip path (no placeholder leakage). Integration test `keyframes-binding-substitution.test.ts` added (3 tests: cross-file import, same-file local export, unknown-key fall-through). Rust unit +5 (259 total); integration +3 (121 total). Template-literal substitution in `animation:` shorthand **deferred**; showcase `Logo.tsx` uses the `animationName:` + explicit duration/timing/iteration form (task 3.22). **Shipped.**
- [x] 3.18 Pass the collection-shape keyframes through `analyzeProject`. Plugin TS receives `keyframesBlocksJson` as an opaque string from NAPI `loadSystemModule` and forwards unchanged to `analyzeProject`; the Rust side consumes the new nested shape (3.16). No TS plugin changes required — the shape change is transparent to Vite + Next plugin code. **Shipped (no-op).**
- [x] 3.19 Rewrite `packages/_integration/__tests__/keyframes-parity.test.ts` for the collection shape. 8 tests pass: single-key emission, frame-body parity, per-key naming, multi-key within a collection, multi-collection emission, coexistence with structured form, empty payload, empty collection. **Shipped (115/115 → 118/118).**
- [x] 3.20 Rewrite `packages/system/__tests__/keyframes.test.ts` for the collection factory shape. 11 tests pass: collection brand, per-key `KeyframeRef` brand + literal-type `__name`, `__frames` payload, string coercion, name determinism (stop order, property order), dedupe, compound stops, empty collection, literal-type preservation at TS level. **Shipped (123 → 134 TS unit tests).**
- [x] 3.21 Migrate `packages/showcase/src/ds.ts` — removed three structured-form `@keyframes` entries (`ember`, `flow`, `tally-pulse`) from `globalStyles` and replaced them with a top-level `animations = keyframes({ ember, flow, tallyPulse })` export. Frame bodies use `{shadows.glow-text}` / `{shadows.glow-text-strong}` token-ref form. `tally-pulse` renamed to `tallyPulse` (camelCase for JS dot access — the emitted CSS name is the FNV hash either way). **Shipped.**
- [x] 3.22 Migrate `packages/showcase/src/components/typography/Logo.tsx:18` — replaced `animation: 'flow 5s linear infinite'` (plus the `@media` reset block's `animation: 'none'`) with `animationName: animations.flow` + explicit `animationDuration / animationTimingFunction / animationIterationCount`. Picked the split-props form over template-literal coercion because template-literal substitution is deferred (per 3.17 scope note). **Shipped.**
- [x] 3.23 Added `packages/showcase/src/components/decorative/EmberGlow.tsx` and `TallyPulse.tsx`, each a minimal `ds.styles({ animationName: animations.<key>, ... }).asElement('span')`. Exported via `components/index.ts` barrel. JSX-referenced in the global-styles MDX demo block (task 3.24) to anchor extraction proof. **Shipped.**
- [x] 3.24 Update `packages/showcase/src/content/architecture/global-styles.mdx` — rewrote the "Top-level `keyframes()` primitive" section to document the collection-of-refs shape with a Callout explaining the narrower frame body vocabulary (`{scale.key}` refs only, no bare scale keys). Rewrote "Referencing Keyframes in Components" to use branded-ref direct access with explicit individual `animation*` properties. Trimmed the structured-form CodeExample to one illustrative `spotlight` keyframe (not conflated with the primitive's names) and added a live `<EmberGlow>` + `<TallyPulse>` demo block. Removed the old `.name` coercion pattern and the deferred-task-3.6 subtext. **Shipped.**
- [x] 3.25 Full verify sweep — **all green**. Final counts: compile ✓ (8 packages), types ✓, unit:ts **134** ✓, unit:rust **259** ✓, canary **197** ✓, integration **121** ✓, showcase build+assert ✓, vite build+assert ✓, next build+assert ✓. Emitted CSS audit confirms end-to-end static substitution: `animation-name: animus-kf-1w7pb41;` on the Logo component's extracted CSS, and `@keyframes animus-kf-5h6he8 { ... }` / `@keyframes animus-kf-1w7pb41 { ... }` / `@keyframes animus-kf-7svg18 { ... }` emitted into `@layer anm-global`. **Incidental bug fix**: added `animation-name` to `UNITLESS_PROPERTIES` in `packages/properties/src/unitless.ts` — without it, the JS-side `applyUnitFallback` mangles hash-name values whose tail is digits (e.g., `animus-kf-1w7pb41` → `animus-kf-1w7pb41px`). Updated `properties.test.ts` count 44→45. Latent bug surfaced by the hash-naming scheme. **Shipped.**

### 3C. Known post-3B caveats (not blockers)

- `EmberGlow` + `TallyPulse` showcase components are defined and barrel-exported but JSX-referenced only from MDX content, which the extraction plugin does not walk. They surface `⚠ component not rendered and not a parent` elimination warnings during showcase build; `@keyframes animus-kf-7svg18` (tallyPulse) still emits via the `keyframes()` collection discovery so the global layer carries all three blocks. The authoritative binding-substitution proof lives in `packages/_integration/__tests__/keyframes-binding-substitution.test.ts`; the Logo component's extracted CSS is the in-showcase static-substitution proof. Wiring the two demo components into a scanned TSX file (e.g., an App.tsx section or a TSX-authored docs page) is a minor polish follow-up.
- Template-literal substitution in `animation:` shorthand (`` animation: `${motion.ember} 5s` ``) is deferred per 3.17 scope note. Sub-task for a later RC iteration.

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
