## Why

The §3B keyframes feature (shipped via `rc-channel-graduation`) has end-to-end proof today only through the direct `runPipeline` harness in `packages/_integration/__tests__/keyframes-binding-substitution.test.ts`. Neither the Next.js plugin (webpack adapter) nor the Vite plugin (rollup adapter) has a post-build positional assertion proving that (a) the branded `keyframes()` collection is discovered via `__brand === 'Keyframes'` on its own plugin-side discovery path, (b) extraction-time binding substitution survives that plugin's bundling pipeline intact, (c) the FNV-1a hash-suffix naming scheme is not re-mangled by the `applyUnitFallback` pipeline (the latent `animus-kf-<hash>px` bug caught mid-session during `rc-channel-graduation` §3B), and (d) the emitted blocks land inside `@layer anm-global` as the cascade contract requires. An invariant proven only through the direct harness is one regression away from silent breakage in production consumers.

## What Changes

- Add a position-aware `assertKeyframesExtracted(css, config?)` helper to `@animus-ui/assertions` covering six invariants in a single call: minimum block count, minimum prefixed `animation-name` reference count, no dangling references (every reference has a matching block), no unit-fallback `px` mangling on identifier-valued names, optional `insideLayer` span constraint, configurable `namePrefix` (default `animus-kf-`).
- Add a `keyframes()` collection export to `e2e/next-app/src/ds.ts` and a consuming component (`animationName: animations.X`) rendered in the App Router page (RSC-safe).
- Add a `keyframes()` collection export to `e2e/vite-app/src/ds.ts` and a consuming component rendered in `src/App.tsx`.
- Extend `e2e/next-app/scripts/assert-build.ts` and `e2e/vite-app/scripts/assert-build.ts` to invoke `assertKeyframesExtracted(css, { insideLayer: 'anm-global', minBlocks: 2, minReferences: 1 })`.
- Extend `scripts/assert-showcase-build.ts` to invoke the same helper against the showcase build, leveraging the `animations` collection already exported from `packages/showcase/src/ds.ts` in §3B.
- Add unit tests to `packages/_assertions/__tests__/assert-css.test.ts` covering every invariant and its failure mode.

## Capabilities

### New Capabilities

None. This change is entirely additive within existing capability boundaries.

### Modified Capabilities

- `structural-css-assertions`: adds a new REQUIREMENT for `assertKeyframesExtracted` — the helper's shape, default configuration, and the six invariants it SHALL check.
- `next-test-app-fixtures`: adds a REQUIREMENT that the fixture defines a `keyframes()` collection export and renders at least one component consuming a branded keyframe ref via `animationName`.
- `next-test-app-assertions`: adds a REQUIREMENT that the post-build assertion script invokes `assertKeyframesExtracted` with `insideLayer: 'anm-global'`.
- `vite-test-app`: adds REQUIREMENTS covering both fixture-side (collection + consuming component rendered in `App.tsx`) and assertion-side (`assertKeyframesExtracted` invocation).
- `showcase-output-assertions`: adds a REQUIREMENT that the post-build assertion script invokes `assertKeyframesExtracted` — treating the `animations` collection already present in the showcase as free coverage. Scope-reduction alternative captured in `design.md` question (c).

## Impact

**Affected code:**
- `packages/_assertions/src/assert-css.ts` — new helper + exported type `KeyframesAssertionConfig`
- `packages/_assertions/src/index.ts` — re-export only if needed (current barrel is `export * from './assert-css'`)
- `packages/_assertions/__tests__/assert-css.test.ts` — new test block
- `e2e/next-app/src/ds.ts` — `keyframes` import + `animations` export
- `e2e/next-app/src/components/` — one new component file
- `e2e/next-app/src/components/index.ts` — barrel update
- `e2e/next-app/app/page.tsx` — render the new component (RSC page)
- `e2e/next-app/scripts/assert-build.ts` — new assertion call
- `e2e/vite-app/src/ds.ts` — `keyframes` import + `animations` export
- `e2e/vite-app/src/components/` — one new component file
- `e2e/vite-app/src/components/index.ts` — barrel update
- `e2e/vite-app/src/App.tsx` — render the new component
- `e2e/vite-app/scripts/assert-build.ts` — new assertion call
- `scripts/assert-showcase-build.ts` — new assertion call (if design.md (c) stays inclusive)

**No-op for:**
- `packages/system/src/keyframes.ts` — shipped in §3B, unchanged
- `packages/extract/src/system_loader.rs` + `theme_resolver.rs` — unchanged
- `packages/properties/src/unitless.ts` — `animation-name` entry added in §3B, unchanged (the assertion makes regression-proofing explicit)
- `packages/_integration/__tests__/keyframes-binding-substitution.test.ts` — continues to serve as authoritative harness-level proof

**Verification tier deltas per root `CLAUDE.md` Change-Type Map:**
- `packages/_assertions/src/**` → `verify:unit:ts && verify:assert:next && verify:assert:showcase && verify:assert:vite`
- `e2e/next-app/**` → `verify:next` (composite: `verify:build:next && verify:assert:next`)
- `e2e/vite-app/src/**` → `verify:vite`
- `scripts/assert-showcase-build.ts` + showcase fixture → `verify:showcase`

No breaking changes. No publishable package version bumps required. No CI workflow changes.
