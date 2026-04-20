## Why

The `keyframes()` factory is a standalone top-level export from `@animus-ui/system`, out of step with its sibling typed-style factory `createGlobalStyles` (which is returned from `createSystem({...}).build()`). This is a factory-shape inconsistency at the primary consumer surface. More importantly, both surfaces carry the same latent type-safety debt: keyframe frame body values are typed as `Record<string, unknown>` and `createGlobalStyles` input is `Record<string, Record<string, any>>`. Neither inherits theme-aware typing, so consumers get no autocompletion or type-checking for `{colors.*}`, `{space.*}`, or scale-token references inside frame bodies or global-style selector maps.

Binding the keyframes factory to the builder return and theme-parameterizing both factories' input types closes both gaps in one pre-0.1.0 stable-graduation cleanup window. Since all published versions are `0.1.0-next.*`, a hard-break reshape is acceptable without a deprecation cycle.

## What Changes

- **BREAKING**: The top-level `keyframes` named export from `@animus-ui/system` is removed. Its role is replaced by a `createKeyframes` method returned from `createSystem({...}).build()` alongside `system` and `createGlobalStyles`. Consumers write `const { system: ds, createKeyframes, createGlobalStyles } = createSystem({...}).build()` and call `ds.createKeyframes({...})`.
- **BREAKING**: `createGlobalStyles` input type is theme-parameterized. Selector-map values become the same `ThemedCSSProps<Theme>` type used by `.styles()` — `{colors.*}`, `{space.*}`, scale-token references autocomplete and type-check.
- **BREAKING**: `createKeyframes` frame body values are theme-parameterized using the same `ThemedCSSProps<Theme>` type. The outer shape is `Record<StopKey, ThemedCSSProps<Theme>>` where `StopKey` is a percentage (`'0%'`, `'50%'`) or keyword (`'from'`, `'to'`).
- The Rust extractor's `__brand === 'Keyframes'` named-export scan continues to work unchanged — consumers assign the bound-factory result to a named export (`export const animations = ds.createKeyframes({...})`) which the existing discovery path finds transparently.
- `includes()` semantics are **not** changed. Cross-package keyframes continue to flow through regular named imports (`import { animations } from 'libDs'`), which the extractor already resolves.
- Three in-repo consumers (`e2e/next-app/src/ds.ts`, `e2e/vite-app/src/ds.ts`, `packages/showcase/src/ds.ts`) migrate from standalone `keyframes({...})` to the bound form.

## Capabilities

### New Capabilities

_None._ This change reshapes the surface and typing of two existing capabilities.

### Modified Capabilities

- `system-builder`: the `.build()` return shape gains a `createKeyframes` method that produces theme-typed keyframe collections. The top-level standalone `keyframes` export is removed.
- `global-styles-system`: the existing `createGlobalStyles` factory's input type is theme-parameterized. Runtime behavior is unchanged; this is a type-layer refinement.
- `rust-extraction-pipeline`: discovery invariant is documented — `createKeyframes` returns the same branded `{ __brand: 'Keyframes' }` shape as the former standalone; consumer is expected to export the collection as a named export for existing named-export scan to find it.
- `next-test-app-fixtures`, `vite-test-app`: fixture imports migrate from `import { keyframes } from '@animus-ui/system'` to the bound form. At least one frame body entry references a theme token to exercise the typing contract.

## Impact

- **Affected code**: `packages/system/src/SystemBuilder.ts` (add `createKeyframes` to build return, theme-parameterize both `createKeyframes` and `createGlobalStyles` input types), `packages/system/src/keyframes.ts` (retain FNV implementation as internal helper; remove top-level export), `packages/system/src/index.ts` (remove standalone export + types). Consumer migrations in `e2e/next-app/src/ds.ts`, `e2e/vite-app/src/ds.ts`, `packages/showcase/src/ds.ts`.
- **Breaking surface**: top-level `keyframes` named export removed. All consumers migrate to the bound form. `GlobalStyleMap` and `KeyframeFrameMap` type-shape narrows (theme-parameterized) — any consumer using `any`-typed values in these inputs may see new type errors where previously they had silent acceptance.
- **No Rust extractor code changes**: F1 named-export convention means the existing scan finds bound-factory-returned collections without plumbing changes.
- **Sequencing constraint**: the `rc-channel-graduation` change (active, 31/75 tasks) adds the standalone `keyframes()` factory requirement to the `system-builder` capability spec via §3B (not yet archived). This change MODIFIES that requirement by removing the standalone form and replacing it with the bound form. Path (a): `rc-channel-graduation` §3B archives first with the standalone requirement in canonical; this change then applies and MODIFIES. The "ship-then-relocate" spec history is cosmetic since nothing archived as stable.
- **No runtime behavior change** for extracted output — same `@keyframes animus-kf-<hash>` blocks in `@layer anm-global`, same FNV hashes, same `animation-name` references. Invariants validated by `e2e-keyframes-assertions` continue to hold.
- **No new workspace dependencies**, no FNV hash algorithm change.
