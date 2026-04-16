# Tasks: pre-release-api-cleanup

## 1. Fix memoization bug in createComponent

- [x] In `packages/system/src/runtime/index.ts`, remove closure-scoped `prevDynKey` and `prevDynStyle` memoization entirely — use `dynamicStyle` from `resolveClasses` directly (RSC-compatible: no hooks, no closure state leaks)
- [x] Update asChild branch to use `dynamicStyle` directly instead of `prevDynStyle`
- [x] Update normal branch to use `dynamicStyle` directly instead of `prevDynStyle`
- [x] Verify: `bun run verify:compile` passes (useRef import added)
- [x] Verify: `bun run verify:unit:ts` passes (existing runtime tests still green)

## 2. Remove dead serialize() from GlobalStyleBlock

- [x] In `packages/system/src/SystemBuilder.ts`, remove the `serialize()` method from the object returned by `createGlobalStyles()`
- [x] Remove the `serialize` property from the `GlobalStyleBlock` type definition (if it's in a type/interface)
- [x] Verify: `bun run verify:compile` passes (no callers to break)

## 3. Document includes() as exploration point

- [x] Add JSDoc comment to `includes()` in `packages/system/src/SystemBuilder.ts` explaining: stub reserved for future multi-system composition, currently a no-op, parameter is accepted for API forward-compatibility but not processed
- [x] Verify: `bun run verify:compile` passes

## 4. Archive stale changes

- [x] Archive `rc-consumer-surface`: `mv openspec/changes/rc-consumer-surface openspec/changes/archive/2026-04-16-rc-consumer-surface`
- [x] Archive `vite-integration-patterns`: `mv openspec/changes/vite-integration-patterns openspec/changes/archive/2026-04-16-vite-integration-patterns`

## 5. Verification

- [x] `bun run verify` (fast gate: lint + compile + types + unit:ts + unit:rust + canary)
- [x] `bun run verify:integration` (pipeline integration tests)
- [x] `bun run verify:showcase` (showcase build + assertions)
