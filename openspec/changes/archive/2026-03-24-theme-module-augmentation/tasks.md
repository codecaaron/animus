## 1. Theme Interface

- [x] 1.1 Add augmentable `Theme` interface to `packages/system/src/types/theme.ts` — extends `BaseTheme`, empty by default
- [x] 1.2 Export `Theme` from `packages/system/src/index.ts`

## 2. Theme-Fixed Scale Types

- [x] 2.1 Add `ThemedScaleValue<Config>` type — mirrors `ScaleValue<Config, T>` but uses fixed `Theme` instead of generic `T`
- [x] 2.2 Add `ThemedScale<Config>` type — `ResponsiveProp<ThemedScaleValue<Config>>`
- [x] 2.3 Add `ThemedCSSProps<Props, Config>` type — per-key mapped type that checks `K extends keyof Config ? ThemedScale<Config[K]> : PropertyTypes[K]`
- [x] 2.4 Add `ThemedCSSPropMap<Props, Config>` type — maps each key to `ThemedCSSProps`

## 3. Method Signatures

- [x] 3.1 Update `Animus.styles()` parameter from `CSSProps<Props, SystemProps<AbstractParser>>` to `ThemedCSSProps<Props, PropRegistry>`
- [x] 3.2 Update `AnimusWithVariants.states()` parameter to `ThemedCSSPropMap<Props, PropRegistry>`
- [x] 3.3 Update `AnimusWithVariants.variant()` base/variants parameters to `ThemedCSSProps`/`ThemedCSSPropMap`
- [x] 3.4 Update `AnimusWithBase.variant()` same as 3.3
- [x] 3.5 Update `AnimusExtendedWithVariants.variant()` and `.states()` parameters
- [x] 3.6 Update `AnimusExtendedWithBase.variant()` parameters
- [x] 3.7 Update `AnimusExtended.styles()` parameter
- [x] 3.8 Class generic bounds remain `CSSProps<AbstractProps, SystemProps<AbstractParser>>` — no changes to class hierarchy

## 4. Showcase Integration

- [x] 4.1 Add `declare module '@animus-ui/system' { interface Theme extends ShowcaseTheme {} }` to `ds.ts`
- [x] 4.2 Fix `m: 1` → `m: 0` in Mono component (caught by new type constraints — `1` not in space scale)
- [x] 4.3 Add `3` to borders scale for StratumRow's `borderLeft: 3`

## 5. Verification

- [x] 5.1 System package compiles with zero errors (`tsc --noEmit`)
- [x] 5.2 `fontSize: 567` correctly produces a type error when `Theme` is augmented
- [x] 5.3 `fontSize: 11` (valid scale key) compiles without error
- [x] 5.4 Showcase builds successfully
- [x] 5.5 TS2742 declaration emit warnings in showcase are expected and harmless (app, not library)
