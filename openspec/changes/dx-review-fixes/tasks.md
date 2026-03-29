## 1. Inline Scale Serialization

- [x] 1.1 Extend `SerializedPropEntry` interface in `SystemBuilder.ts` to accept `scale` as `string | Record<string, string | number> | (string | number)[]` instead of just `string`
- [x] 1.2 Update `serializeInstance()` to serialize inline MapScale (object) and ArrayScale (array) scales as JSON alongside string scale references
- [x] 1.3 Add `negative?: boolean` to `SerializedPropEntry` and serialize it when present on the prop config
- [ ] 1.4 Add canary test: component with `withProperties()` inline MapScale resolves correctly through extraction
- [ ] 1.5 Add canary test: prop with `negative: true` resolves negative values through extraction

## 2. deepMerge Deduplication

- [x] 2.1 Create `packages/system/src/utils/deepMerge.ts` with the shared implementation
- [x] 2.2 Update `Animus.ts` to import deepMerge from the shared utility
- [x] 2.3 Update `AnimusExtended.ts` to import deepMerge from the shared utility
- [x] 2.4 Verify all existing tests pass with no behavioral change

## 3. Remove Vestigial .build()

- [x] 3.1 Remove `.build()` method from `AnimusWithAll` class in `Animus.ts`
- [x] 3.2 Remove `.build()` method from `AnimusExtendedWithAll` class in `AnimusExtended.ts`
- [x] 3.3 Verify `.extend()` is available on `.asElement()`, `.asComponent()`, and `.asClass()` return types
- [x] 3.4 Update any type tests that reference `.build()` on the component chain

## 4. Build Pipeline Hardening

- [x] 4.1 Replace `globalThis.__animus_system_resolve_script` with a closure-scoped variable in the plugin factory
- [x] 4.2 Namespace `globalThis.__animus_component_sheet__` with a hash derived from the system module path
- [x] 4.3 Add strict mode check to `loadSystem()` catch block — throw instead of warn when `options.strict` is true
- [x] 4.4 Add strict mode check to `resolveGlobalStyles()` catch block
- [x] 4.5 Add strict mode check to transform resolution catch block

## 5. Stale Artifact Cleanup

- [x] 5.1 Remove stale comment in `Card.tsx` lines 12-14 about exporting slots for extraction
- [x] 5.2 Run `bun run verify` to confirm all changes pass
