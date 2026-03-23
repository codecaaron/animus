## 1. Package Scaffolding

- [x] 1.1 Create `packages/system/` with package.json (`@animus-ui/system`), tsconfig, tsdown config. Dependencies: `@animus-ui/theming` (for ThemeBuilder). No Emotion.
- [x] 1.2 Add `@animus-ui/system` to workspace, verify `bun install` resolves it
- [x] 1.3 Add build target to the build DAG (system builds after theming, before vite-plugin)

## 2. Type System (T-First)

- [x] 2.1 Create `src/types/theme.ts` — export `BaseTheme` (from core or redefined). No `AbstractTheme`, no `Theme` augmentable interface, no `CompatTheme`.
- [x] 2.2 Create `src/types/config.ts` — `Prop`, `ScaleValue<Config, T>`, `Scale<Config, T>`, `CSSProps<Props, System, T>`, `CSSPropMap`, `ParserProps<Config, T>`, `Parser<Config, T>`, `SystemProps`. All parameterized by T. No CompatTheme fallback branch.
- [x] 2.3 Create `src/types/props.ts` — `ThemeProps<Props, T>`, `ResponsiveProp<V>`, `MediaQueryMap`, `MediaQueryArray`, `AbstractProps`. `theme` typed as `T` not `AbstractTheme`.
- [x] 2.4 Copy shared types: `src/types/shared.ts` (CSSObject, NarrowPrimitive), `src/types/scales.ts` (MapScale, ArrayScale), `src/types/utils.ts`, `src/types/properties.ts`
- [x] 2.5 Spike: verify ScaleValue<Config, T> with showcase's complex theme (30 tokens, 6 scales, color modes). Check TypeScript doesn't hit instantiation depth limits.

## 3. Prop Groups and Transforms

- [x] 3.1 Copy prop group definitions into `src/groups/` — all 13 groups as individual files. Export from `src/groups/index.ts`.
- [x] 3.2 Copy transform system — `src/transforms/createTransform.ts`, `src/transforms/size.ts`, `src/transforms/border.ts`, `src/transforms/grid.ts`
- [x] 3.3 Copy scale utilities — `src/scales/createScale.ts`, `src/scales/lookupScaleValue.ts`
- [x] 3.4 Update all internal imports to reference system package types (T-parameterized versions)

## 4. Builder Chain (T-Threaded)

- [x] 4.1 Create `src/Animus.ts` — 6 builder classes with `T extends BaseTheme` as first generic. Signatures: `Animus<T, PR, GR, BP>` → `AnimusWithBase<T, PR, GR, BP, BS>` → ... → `AnimusWithAll<T, PR, GR, BP, BS, V, S, AG, CP>`
- [x] 4.2 Terminal methods (`.asElement()`, `.asComponent()`, `.build()`) produce runtime-shim-compatible output, NOT Emotion styled components. Use `createComponent` from `@animus-ui/runtime`.
- [x] 4.3 Create `src/AnimusExtended.ts` — extension system with T as first generic (9 generics total). Same flexible ordering, merge semantics.
- [x] 4.4 Replace `lodash.merge` in AnimusExtended with a focused deep-merge utility (~20 lines)
- [x] 4.5 Wire `.extend()` on terminal components to produce `AnimusExtended<T, ...>` carrying the same T
- [x] 4.6 Verify: builder chain with T produces correct autocomplete for scale-resolved props

## 5. System Builder (Concentric)

- [x] 5.1 Create `src/SystemBuilder.ts` — `createSystem()` returns a SystemBuilder. `.withTokens(cb)` accepts a callback receiving a ThemeBuilder, returns `SystemBuilder<T>`. `.withProperties(cb)` accepts a callback receiving a PropertyBuilder, returns `SystemBuilder<T, PropReg, GroupReg>`.
- [x] 5.2 Create `src/PropertyBuilder.ts` — `.addGroup(name, props)` accumulates PropRegistry and GroupRegistry generics. `.build()` returns the accumulated config.
- [x] 5.3 SystemBuilder `.build()` terminal — constructs and returns a SystemInstance that extends Animus (inherits builder chain methods) and exposes `.serialize()` and `.tokens`
- [x] 5.4 Implement `.serialize()` — walks all groups, extracts named transforms into a registry, returns `{ tokens, propConfig, groupRegistry, transforms }`
- [x] 5.5 Export `createSystem` from package entry point (`src/index.ts`). Re-export groups, transforms, createTransform, type utilities.

## 6. Plugin Integration

- [x] 6.1 Add `system` option to `animusExtract()` plugin options (alongside existing `configPath`/`themePath` for backwards compat during transition)
- [x] 6.2 Implement `loadSystem()` — single bun subprocess that imports the system module and calls `.serialize()`
- [x] 6.3 When `system` option is provided: use `loadSystem()` instead of `loadConfig()` + `loadTheme()`. Build transform registry from `serialize().transforms` in-process.
- [x] 6.4 Geological reset: when the system file changes during HMR, trigger full reload via `loadSystem()` (replaces separate config/theme file checks)
- [ ] 6.5 Auto-detection: when no `system` option provided, search for a module exporting a SystemInstance (fallback to existing config/theme detection)

## 7. Showcase Migration

- [x] 7.1 Consolidate `showcase/src/theme.ts` + `showcase/src/custom-vocabulary.tsx` into `showcase/src/ds.ts` using `createSystem().withTokens().withProperties().build()`
- [x] 7.2 Remove `declare module '@animus-ui/core'` augmentation from showcase
- [x] 7.3 Update all showcase component imports to use the new `ds` from system package
- [x] 7.4 Update `showcase/vite.config.ts` — use `system: './src/ds.ts'` plugin option
- [x] 7.5 Verify: `bun run build` produces correct extracted CSS with system package
- [x] 7.6 Verify: `bun run dev` HMR works with system-based config loading

## 8. Verification

- [ ] 8.1 Update canary test to exercise system package builder chain (or add parallel test)
- [x] 8.2 Run `bun run verify` — build, test, biome all pass
- [x] 8.3 Verify TypeScript autocomplete: scale props show T-derived values in editor
- [x] 8.4 Verify no Emotion imports in `packages/system/` (grep check)
- [ ] 8.5 Delete `@animus-ui/ui` package (dead code, no consumers)
