## 1. Helper + unit tests (structural-css-assertions)

- [ ] 1.1 Add `KeyframesAssertionConfig` interface and `assertKeyframesExtracted(css, config?)` helper to `packages/_assertions/src/assert-css.ts` (six invariants per spec: block count, reference count, dangling refs, px-mangling, insideLayer span, prefix conformance)
- [ ] 1.2 Extend `packages/_assertions/__tests__/assert-css.test.ts` with a `describe('assertKeyframesExtracted', ...)` block covering: passing well-formed CSS, missing-blocks failure, dangling-ref failure, px-mangling failure, keyword-skip edge case, insideLayer on/off (inside and outside), missing insideLayer block, minBlocks threshold, custom namePrefix
- [ ] 1.3 Build `@animus-ui/assertions` via `bun run --filter @animus-ui/assertions build:ts` so consumers pick up the new export
- [ ] 1.4 Run `bun run verify:unit:ts` — all assertion tests pass
- [ ] 1.5 Run `bun run verify:compile && bun run verify:types` — no type regressions

## 2. Next-app fixture + assertion (next-test-app-fixtures, next-test-app-assertions)

- [ ] 2.1 Add `keyframes` to the import from `@animus-ui/system` in `e2e/next-app/src/ds.ts` and export `animations = keyframes({ <name1>: { ... }, <name2>: { ... } })` with at least two distinct frame bodies
- [ ] 2.2 Create `e2e/next-app/src/components/<ComponentName>.tsx` that uses `ds.styles({ animationName: animations.<key>, animationDuration: '<duration>', animationTimingFunction: '<function>', animationIterationCount: '<count>' }).asElement('<tag>')` with a literal member-expression keyframe ref
- [ ] 2.3 Re-export the new component from `e2e/next-app/src/components/index.ts`
- [ ] 2.4 Render the new component at least once in `e2e/next-app/app/page.tsx` (RSC page — no `"use client"`)
- [ ] 2.5 Run `bun run --filter @animus-ui/next-app build` and inspect `.next/static/css/*.css` — confirm `animation-name:animus-kf-<hash>` + matching `@keyframes animus-kf-<hash>` blocks are emitted CSS-side (gate from design D1 risk)
- [ ] 2.6 Extend `e2e/next-app/scripts/assert-build.ts` with `import { assertKeyframesExtracted } from '@animus-ui/assertions'` and add `assertKeyframesExtracted(css, { insideLayer: 'anm-global', minBlocks: <N>, minReferences: 1 })` where `<N>` matches the fixture collection's keyframe count
- [ ] 2.7 Run `bun run verify:next` — all Next assertions (including keyframes) pass

## 3. Vite-app fixture + assertion (vite-test-app)

- [ ] 3.1 Add `keyframes` to the import from `@animus-ui/system` in `e2e/vite-app/src/ds.ts` and export `animations = keyframes({ <name1>: { ... }, <name2>: { ... } })` with at least two distinct frame bodies
- [ ] 3.2 Create `e2e/vite-app/src/components/<ComponentName>.tsx` that uses `ds.styles({ animationName: animations.<key>, ... }).asElement('<tag>')` with a literal member-expression keyframe ref
- [ ] 3.3 Re-export the new component from `e2e/vite-app/src/components/index.ts`
- [ ] 3.4 Render the new component at least once in `e2e/vite-app/src/App.tsx`
- [ ] 3.5 Extend `e2e/vite-app/scripts/assert-build.ts` with `import { assertKeyframesExtracted } from '@animus-ui/assertions'` and add `assertKeyframesExtracted(css, { insideLayer: 'anm-global', minBlocks: <N>, minReferences: 1 })` where `<N>` matches the fixture collection's keyframe count
- [ ] 3.6 Run `bun run verify:vite` — all Vite assertions (including keyframes) pass

## 4. Showcase assertion (showcase-output-assertions)

- [ ] 4.1 Extend `scripts/assert-showcase-build.ts` with `import { assertKeyframesExtracted } from '@animus-ui/assertions'` and add `assertKeyframesExtracted(css, { insideLayer: 'anm-global' })` against the concatenated showcase CSS (the showcase's `animations` export from §3B provides the fixture)
- [ ] 4.2 Run `bun run verify:showcase` — all showcase assertions (including keyframes) pass

## 5. Full verification + openspec close-out

- [ ] 5.1 Run `bun run verify:full` — the full local pipeline proof passes (lint + compile + types + unit:ts + unit:rust + canary + integration + all builds + all assert tiers)
- [ ] 5.2 Run `openspec validate e2e-keyframes-assertions --strict` — returns valid
- [ ] 5.3 Confirm no unintended diff in `packages/system`, `packages/extract`, `packages/properties` (this change is additive at `_assertions` + e2e + showcase script only)
