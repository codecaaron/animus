## 1. SystemBuilder Changes

- [ ] 1.1 Remove `withGlobalStyles` method from `SystemBuilder` class
- [ ] 1.2 Remove `GlobalStylesConfig` type and `#globalStyles` private field
- [ ] 1.3 Change `.build()` return type from `SystemInstance` to `{ system: SystemInstance, createGlobalStyles: GlobalStylesFactory }`
- [ ] 1.4 Implement `createGlobalStyles` factory closure that captures propRegistry and transforms from the build
- [ ] 1.5 Remove `globalStyles` from `SerializedConfig` interface
- [ ] 1.6 Update `serializeInstance` to no longer accept or return globalStyles

## 2. Global Styles Factory

- [ ] 2.1 Define `GlobalStylesFactory` type: `(styles: Record<string, Record<string, any>>) => GlobalStyleBlock`
- [ ] 2.2 Define `GlobalStyleBlock` type that carries the resolved styles and a serialization method for the plugin
- [ ] 2.3 Implement the factory function — accepts flat selector map, stores with reference to prop config and transforms

## 3. Plugin Updates

- [ ] 3.1 Update resolve-global-styles subprocess to discover global style blocks from module exports instead of `serialize().globalStyles`
- [ ] 3.2 Update plugin `buildStart` to handle the new discovery path for global styles
- [ ] 3.3 Remove `parsed.globalStyles.reset` / `parsed.globalStyles.global` branching — process all blocks uniformly
- [ ] 3.4 Update system load subprocess script to handle destructured build result (look for `ds` or `system` export)

## 4. Export Updates

- [ ] 4.1 Export `GlobalStylesFactory` and `GlobalStyleBlock` types from `packages/system/src/index.ts`
- [ ] 4.2 Remove `GlobalStylesConfig` export

## 5. Consumer Migration

- [ ] 5.1 Update `packages/showcase/src/ds.ts` — destructure build result, move global styles to `createGlobalStyles()` calls
- [ ] 5.2 Update any showcase imports that reference `ds` directly (verify they still work with destructured export name)

## 6. Verification

- [ ] 6.1 Run `bun run verify` — all TS builds and tests pass
- [ ] 6.2 Run `bun run verify:showcase` — showcase builds with extracted CSS including `@layer global` content
- [ ] 6.3 Verify global styles appear in browser devtools under `@layer global`
