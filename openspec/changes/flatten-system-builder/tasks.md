## Combined: separate-global-styles + flatten-system-builder

Single implementation pass. Both proposals target SystemBuilder. Phases ordered by dependency.

## 1. SystemBuilder Core Rewrite

- [ ] 1.1 Remove `withGlobalStyles` method, `#globalStyles` field, and `GlobalStylesConfig` type/interface from SystemBuilder.ts
- [ ] 1.2 Remove `withProperties` method and `PropertyBuilder` import from SystemBuilder.ts
- [ ] 1.3 Add `.addGroup(name, config)` method directly on SystemBuilder — accumulates PropReg + GroupReg via #checkpoint pattern, returns new SystemBuilder instance
- [ ] 1.4 Add `.addProps(config)` method on SystemBuilder — registers props without group assignment, accumulates PropReg only
- [ ] 1.5 Implement overlap tolerance in `.addGroup()` — when prop key exists in PropReg, allow if definition matches (shallow check: property, scale, transform, negative), error if mismatch
- [ ] 1.6 Implement collision constraint — addGroup generic constrains Name to `Exclude<string, keyof PropReg>`, preventing group names that collide with prop names
- [ ] 1.7 Change `.build()` return type to `{ system: SystemInstance, createGlobalStyles: GlobalStylesFactory }`
- [ ] 1.8 Implement `createGlobalStyles` factory closure in `.build()` — captures propRegistry and transforms, accepts flat `Record<string, Record<string, any>>`, returns `GlobalStyleBlock`
- [ ] 1.9 Remove `globalStyles` from `SerializedConfig` interface and `serializeInstance` function
- [ ] 1.10 Delete `PropertyBuilder.ts`

## 2. Types and Exports

- [ ] 2.1 Define `GlobalStylesFactory` type: `(styles: Record<string, Record<string, any>>) => GlobalStyleBlock`
- [ ] 2.2 Define `GlobalStyleBlock` type with serialization method for the plugin
- [ ] 2.3 Update `packages/system/src/index.ts` — remove PropertyBuilder + GlobalStylesConfig exports, add GlobalStylesFactory + GlobalStyleBlock exports
- [ ] 2.4 Update activation types for mixed namespace: `.system()` accepts `(keyof GroupReg | keyof PropReg)[]`

## 3. Component Chain Rename

- [ ] 3.1 Rename `.groups()` → `.system()` in `Animus.ts` — method name, type-state class (AnimusWithGroups → AnimusWithSystem or equivalent)
- [ ] 3.2 Rename `.groups()` → `.system()` in `AnimusExtended.ts`
- [ ] 3.3 Implement mixed namespace resolution in `.system()` — identifier is either a group name (activate all props in group) or a prop name (activate that single prop)

## 4. Rust Crate

- [ ] 4.1 Update `chain_walker.rs` CHAIN_METHODS: `"groups"` → `"system"`
- [ ] 4.2 Update `lib.rs` match arm: `"groups"` → `"system"` in stage processing
- [ ] 4.3 Add individual prop activation: when system stage key doesn't match a group name, check if it's a direct prop name in propConfig
- [ ] 4.4 Update `transform_emitter.rs` test fixture (line 744): `.groups(` → `.system(`
- [ ] 4.5 Update `chain_walker.rs` test fixtures (lines 400, 549): `.groups(` → `.system(`
- [ ] 4.6 Update `lib.rs` doc comment (line 353): `.groups()` → `.system()`

## 5. Vite Plugin

- [ ] 5.1 Update `resolve-global-styles.ts` — discover global style blocks from module exports instead of `serialize().globalStyles`
- [ ] 5.2 Update `index.ts` buildStart — handle new global styles discovery path (look for exported GlobalStyleBlock instances)
- [ ] 5.3 Remove `parsed.globalStyles.reset` / `parsed.globalStyles.global` branching — process all blocks uniformly
- [ ] 5.4 Update system load subprocess script to handle `{ system, createGlobalStyles }` destructured build result

## 6. Showcase Migration

- [ ] 6.1 Rewrite `packages/showcase/src/ds.ts` — flat `.addGroup()` chain, destructure build result, move global styles to `createGlobalStyles()` calls
- [ ] 6.2 Rename `.groups({...})` → `.system({...})` across all showcase components (~30 files)
- [ ] 6.3 Rename `.groups({...})` → `.system({...})` in `packages/ui/src/` elements (~10 files)

## 7. Test & Fixture Updates

- [ ] 7.1 Update `packages/system/__tests__/test-system.ts` — flat chain, no withProperties
- [ ] 7.2 Update `packages/system/__tests__/types.test-d.tsx` — .groups() → .system(), withProperties → addGroup
- [ ] 7.3 Update extraction test fixtures: `system-props.tsx`, `variant-groups.tsx`, `custom-props.tsx`, `negative-margin.tsx`, `extension-parent.tsx`, `pkg-barrel/elements/Box.tsx` — all `.groups(` → `.system(`
- [ ] 7.4 Update `packages/extract/tests/canary.test.ts` — `.groups(` → `.system(`
- [ ] 7.5 Add test: overlap tolerance (same prop in two addGroup calls with matching definition)
- [ ] 7.6 Add test: collision constraint (group name = prop name produces error)
- [ ] 7.7 Add test: mixed namespace in .system() — group name + individual prop name
- [ ] 7.8 Add test: ungrouped prop registered via .addProps() participates in style resolution

## 8. Documentation

- [ ] 8.1 Update `packages/showcase/src/content/api/create-system.md` — new API surface
- [ ] 8.2 Update `packages/showcase/src/content/api/builder-chain.md` — .system() replaces .groups()
- [ ] 8.3 Update `packages/showcase/src/content/concepts/responsive-props.md` — .system() reference
- [ ] 8.4 Update `packages/showcase/src/content/getting-started.md` — new system definition pattern
- [ ] 8.5 Update `packages/showcase/CLAUDE.md` — new chain description

## 9. Verification

- [ ] 9.1 Run `bun run verify` — all TS builds and tests pass
- [ ] 9.2 Run `bun run test:canary` — all Rust extraction canary tests pass
- [ ] 9.3 Run `bun run verify:showcase` — showcase builds with correct extracted CSS including `@layer global`
- [ ] 9.4 Verify in browser: global styles render, system props work, cascade precedence correct
