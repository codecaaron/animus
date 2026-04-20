## 0. Design resolution (complete)

- [x] 0.1 Sequencing confirmed: path (a) — `rc-channel-graduation` §3B archives first with the standalone factory requirement; this change then MODIFIES that requirement to the bound form. Reason: redirecting rc's in-flight spec (path c) would desynchronize rc's already-shipped §3B code from its tasks/specs; path (a) lets each change complete on its own timeline. Spec-history cost is cosmetic since nothing archives as stable.
- [x] 0.2 Decision A resolved: `createKeyframes` (matches sibling `create*` factories in `.build()` destructure).
- [x] 0.3 Decision B resolved: remove standalone `keyframes` export. No in-repo internal dependencies; all 3 consumer sites migrate in Phase 3.
- [x] 0.4 Decision C resolved: C3 pass-through — `includes()` semantics unchanged; cross-package keyframes continue to flow via regular named imports. Removes scope that was solving a non-problem.
- [x] 0.5 Decision D resolved: D1 same change — `createGlobalStyles` input type is theme-parameterized in this change alongside `createKeyframes`.
- [x] 0.6 Decision E resolved: E1 reuse `ThemedCSSProps<Theme>` for both `createKeyframes` stop bodies and `createGlobalStyles` selector-body values. Outer keyframe shape is `Record<StopKey, ThemedCSSProps<Theme>>`.
- [x] 0.7 Decision F resolved: F1 named-export convention. No Rust plumbing changes — existing `__brand === 'Keyframes'` scan finds bound-factory-returned collections via consumer's named export.
- [x] 0.8 Decision G resolved: G3 hard break. 3 in-repo consumers migrate in Phase 3. All published versions are `0.1.0-next.*` — pre-release marker is the contract.
- [x] 0.9 Placeholder copy normalized across `proposal.md`, `design.md`, specs. `openspec validate theme-typed-keyframes-binding --strict` passes.

## 1. System builder surface + type machinery

- [x] 1.1 Extend `packages/system/src/SystemBuilder.ts` `.build()` return to include `createKeyframes` alongside `system` and `createGlobalStyles`. Reuse the pure-FNV implementation from `packages/system/src/keyframes.ts` verbatim — move the runtime to an internal module if needed, but preserve the serialization + hash algorithm byte-for-byte so FNV names stay stable across the surface change.
- [x] 1.2 Theme-parameterize `createKeyframes` input type: the outer frame map is `Record<string, Record<StopKey, ThemedCSSProps<Theme>>>` where `StopKey` is a percentage/keyword string literal union. Stop body values reuse `ThemedCSSProps<Theme>` (E1). Wire the builder's accumulated theme shape through to the factory's generic parameter using the existing `Assign`/`Merge` mapped-type cache boundaries.
- [x] 1.3 Theme-parameterize `createGlobalStyles` input type (D1 parity): `Record<string, ThemedCSSProps<Theme>>` — same reuse, same typing engine as `.styles()`. Preserve the existing runtime signature (brand, serialize method). (Side-effect: showcase `ds.ts` lines 695–696 used raw CSS values for strict-scale props; fixed to scale tokens inline since theme-typing correctly caught the latent debt.)
- [x] 1.4 Added type-test coverage in `packages/system/__tests__/types.test-d.tsx`: positive assertions for theme-token refs inside keyframe stop bodies and global-style selector bodies; `@ts-expect-error` negative assertions for unknown scale keys in both. Test fixture extended to destructure `createKeyframes` + `createGlobalStyles` from the builder in `test-system.ts`.
- [x] 1.5 Removed top-level `keyframes` named export from `packages/system/src/index.ts`. Kept `KeyframeFrameMap`, `KeyframeRef`, `Keyframes` as type-only exports for consumers annotating return values. `CreateKeyframesFactory` added to public type exports (required for TS2742 portable-declaration emit). No internal module inside `packages/system/` imports the standalone form (`keyframesImpl` reused internally by `SystemBuilder.ts`).
- [x] 1.6 Run `bun run verify:compile && bun run verify:types && bun run verify:unit:ts` per the Change-Type Map row for `packages/system/src/**`. All green (147 unit tests pass, types clean after showcase fix).

## 2. Rust extractor — named-export convention (F1)

- [x] 2.1 Verified: F1 named-export convention works without code changes. The existing `__brand === 'Keyframes'` scan in `packages/extract/src/project_analyzer.rs` + `system_loader.rs` finds `export const animations = ds.createKeyframes({...})` transparently — the branded shape is indistinguishable from the former standalone output.
- [x] 2.2 `verify:integration` green (121 pass, 0 fail) — discovery path resolves bound-factory references end-to-end.

## 3. Consumer migration

- [x] 3.1 Migrated `e2e/next-app/src/ds.ts` to bound form. Theme-token reference added: `bg: 'background'` → `bg: 'surface'` in `fadeIn` stops. FNV hash changed intentionally (new frame body content) — produces `animus-kf-1x7guim` for fadeIn. `pulse` unchanged (`animus-kf-1yqv0zl`).
- [x] 3.2 Migrated `e2e/vite-app/src/ds.ts` identically — same hash outcomes confirming FNV stability across webpack (Next) and rollup (Vite) build paths.
- [x] 3.3 Migrated `packages/showcase/src/ds.ts` keyframes collection (3 named keyframes: `ember`, `flow`, `tallyPulse`). Showcase already had a theme-token reference (`'{shadows.glow-text}'`) so no frame body changes beyond the factory binding. Incidental fix: showcase reset-style global's `fontFamily: 'monospace, monospace'` → `'mono'` (scale token) and `fontSize: '1em'` → `'inherit'` (theme-typing caught latent source debt).
- [x] 3.4 All 3 consumer verifications green (`verify:next`, `verify:vite`, `verify:showcase`) — builds succeed, assertions pass.

## 4. Verification & sign-off

- [x] 4.1 `verify:full` green — every tier passed: lint (257 files), compile (8 packages), types, unit:ts (147 pass), unit:rust (259 pass), canary, integration (121 pass), build:next/showcase/vite, assert:next/showcase/vite.
- [x] 4.2 `openspec validate theme-typed-keyframes-binding --strict` returns valid.
- [x] 4.3 Visual CSS audit complete:
  - Next: 2 keyframes blocks present (`animus-kf-1x7guim`, `animus-kf-1yqv0zl`).
  - Vite: same 2 hashes — FNV stability proven across webpack (Next) + rollup (Vite) build paths.
  - Showcase: 3 keyframes blocks present (`animus-kf-1w7pb41`, `animus-kf-5h6he8`, `animus-kf-7svg18`).
  - Unresolved token check: 0 occurrences of `{colors.*}` or `{space.*}` in any built CSS.
- [x] 4.4 Sequencing dissolved: `rc-channel-graduation` §§2+3 (includes relocation + standalone keyframes factory) stripped from rc per user direction ("don't need more history for this specifically"). rc becomes pure release-infrastructure; all capability spec deltas for keyframes + theme-typing land through this change directly. This change's `system-builder` delta is now pure ADDED (no REMOVED target needed).
- [x] 4.5 Archiving now (user-directed).
