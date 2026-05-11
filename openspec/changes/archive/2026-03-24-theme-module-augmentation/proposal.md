## Why

The system package's CSS object types (`.styles()`, `.variant()`, `.states()`) accepted any value for any property — `fontSize: 567` compiled without error because the type chain from tokens through the builder classes used `AbstractParser`, which resolved to `Record<string, any>`. This defeated the purpose of the finite style machine: the configuration space was declared finite at runtime but infinite at compile time.

The root cause: the generic `T` (theme type) threaded through the 8-deep class hierarchy never connected to the CSS object constraint types. `CSSProps<Props, SystemProps<AbstractParser>>` discarded all scale information because `AbstractParser` has no knowledge of the theme.

Attempts to thread `T` through to the CSS constraints via `ThemedSystemProps<PropRegistry, T>` or `ThemedCSSProps<Props, PropRegistry, T>` hit TypeScript's complexity ceiling (`TS2590: Expression produces a union type that is too complex to represent`) because the full prop registry (~60 props) × scale resolution creates a combinatorial explosion at the class definition level.

The solution: an augmentable `Theme` interface (following the Emotion/styled-components pattern). Instead of threading a generic through the hierarchy, CSS constraints reference a fixed `Theme` interface that consumers extend via `declare module`. This makes scale resolution a constant-time type operation (no generics to expand) while preserving full type safety.

## What Changes

- New `Theme` augmentable interface in `packages/system/src/types/theme.ts` — empty by default, consumers extend via `declare module '@animus-ui/system' { interface Theme extends MyTheme {} }`
- New `ThemedScaleValue<Config>` and `ThemedScale<Config>` types that use the fixed `Theme` for scale resolution instead of generic `T`
- New `ThemedCSSProps<Props, Config>` and `ThemedCSSPropMap<Props, Config>` types — per-key scale constraint using `ThemedScale`
- `.styles()`, `.variant()`, `.states()` method parameter types updated from `CSSProps<Props, SystemProps<AbstractParser>>` to `ThemedCSSProps<Props, PropRegistry>` in both `Animus.ts` and `AnimusExtended.ts`
- Class generic bounds remain unchanged (`AbstractParser`) — only method parameters are themed
- `Theme` exported from `@animus-ui/system` package index
- Showcase augments `Theme` with `ShowcaseTheme` in `ds.ts`

## Capabilities

### New Capabilities
- `theme-module-augmentation`: Augmentable `Theme` interface enables compile-time scale constraints in CSS objects. Consumers get type errors for values outside their declared scales.

### Modified Capabilities
- `builder-chain`: `.styles()`, `.variant()`, `.states()` now constrain CSS values to theme scales when `Theme` is augmented.

## Impact

- **System package** (`packages/system/`): New types in `types/config.ts` and `types/theme.ts`. Method signatures in `Animus.ts` and `AnimusExtended.ts` updated. No runtime changes. No breaking API changes (existing code compiles — constraints only tighten when `Theme` is augmented).
- **Showcase** (`packages/showcase/`): `ds.ts` adds `declare module '@animus-ui/system' { interface Theme extends ShowcaseTheme {} }` — one line, full constraint.
