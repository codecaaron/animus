## Why

The design system's provenance is fragmented across three separate concerns that are loaded, serialized, and typed independently:

1. **Theme** (`@animus-ui/theming`) — scales, colors, color modes, breakpoints
2. **Config** (`@animus-ui/core`) — prop registry, group registry, transforms
3. **Builder instance** (`createAnimus().addGroup().build()`) — the runtime entry point

This fragmentation causes:

- **3 bun subprocesses** in the Vite plugin: one for config, one for theme, one for transforms. Each adds ~50ms to startup and (for transforms) to every HMR cycle.
- **`declare module` ceremony**: consumers must `declare module '@animus-ui/core' { interface Theme extends MyTheme {} }` in a separate file to get type-safe scale resolution.
- **CompatTheme fallback chain**: Scale types resolve through `keyof Theme` → MapScale → ArrayScale → `keyof CompatTheme` → PropertyValues. A leaky abstraction from the Emotion era.
- **Runtime prop filtering bug**: custom vocabulary props like `fluidSize` leak to the DOM because the runtime shim doesn't know about custom group props. The instance has this information but the plugin doesn't pass it through completely.
- **Transform subprocess on every HMR**: `resolve-transforms.ts` runs via bun on every file save to resolve `__TRANSFORM__` placeholders. The transform functions exist in the instance's prop registry — they should be loaded once and held in memory.

## What Changes

Co-locate theme INTO the builder instance. The instance becomes the **single source of truth** for the entire design system.

### Consumer API

```typescript
// Before: two files, three concerns, augmentation dance
// theme.ts
export const theme = createTheme({...}).addColors({...}).build();
declare module '@animus-ui/core' { interface Theme extends typeof theme {} }

// ds.ts
export const ds = createAnimus().addGroup('surface', surface).build();
export const getExtractConfig = () => serializeExtractConfig(ds);

// After: one file, one object, types flow naturally
export const ds = createAnimus()
  .withTheme(createTheme({...}).addColors({...}).build())
  .addGroup('surface', surface)
  .build();
// Theme types flow from .withTheme() — no declare module needed
// Extract config, transforms, theme all available via ds
```

### Type System

Add `T extends BaseTheme` as a leading generic on the builder chain. Theme flows through the entire type-state machine:

```
Animus<T, PropRegistry, GroupRegistry, BaseParser>
  → AnimusWithBase<T, ...>
    → AnimusWithVariants<T, ...>
      → AnimusWithStates<T, ...>
        → AnimusWithSystem<T, ...>
          → AnimusWithAll<T, ...>
            → AnimusExtended<T, ...>
```

`ScaleValue<Config>` becomes `ScaleValue<Config, T>`. Scale resolution checks `keyof T[scale]` directly instead of the global `Theme` interface.

### Plugin Simplification

```
Before: 3 subprocesses           After: 1 subprocess
─────────────────────            ──────────────────────
bun -e loadConfig()              bun -e loadInstance()
bun -e loadTheme()                 → theme, config, groups,
bun -e resolveTransforms()           transforms ALL from one object
```

Transform registry built in-process at startup from the instance's prop registry. No subprocess on HMR.

### Plugin API

```typescript
// Before: multiple options for separate concerns
animusExtract({
  configPath: './src/custom-vocabulary.tsx',
  themePath: './src/theme.ts',  // or auto-detect
})

// After: one option
animusExtract({
  instance: './src/ds.ts',  // or auto-detect
})
```

## What This Kills

- `CompatTheme` type and its fallback chain
- `AbstractTheme` interface (`[key: string]: any` escape hatch)
- `Theme` augmentable interface (no more `declare module`)
- `resolve-transforms.ts` as a subprocess script (transforms in-process)
- `evaluateThemeObject` as a separate code path (theme comes from instance)
- Separate `themePath` / `configPath` plugin options
- `serializeExtractConfig` as a standalone utility (instance serializes itself)
- The ~50-100ms bun subprocess cost on every HMR cycle

## Capabilities

### Modified Capabilities
- `builder-chain`: Theme generic `T` added to all 6 builder classes + AnimusExtended
- `prop-system`: `ScaleValue`, `Scale`, `CSSProps`, `CSSPropMap`, `ParserProps` all parameterized by `T`
- `vite-extraction-plugin`: Single instance entry point, in-process transform registry, no HMR subprocess
- `custom-instance-extraction`: `configPath` replaced by `instance` option

### Removed Capabilities
- `compat-theme-fallback`: CompatTheme type and fallback chain removed

## Impact

- **`packages/core/src/Animus.ts`**: `T` generic on all 6 classes, threaded through constructors and method returns
- **`packages/core/src/AnimusExtended.ts`**: `T` generic, inherited from parent
- **`packages/core/src/AnimusConfig.ts`**: `.withTheme(theme)` method captures `T`
- **`packages/core/src/types/config.ts`**: `ScaleValue<Config, T>`, `Scale<Config, T>`, `CSSProps<..., T>`, `ParserProps<..., T>`
- **`packages/core/src/types/theme.ts`**: Kill `AbstractTheme`, `Theme` augmentable interface. Keep `BaseTheme`.
- **`packages/core/src/types/props.ts`**: `ThemeProps<Props, T>` parameterized
- **`packages/core/src/compatTheme.ts`**: Delete entirely
- **`packages/vite-plugin/src/index.ts`**: Single `instance` option, one subprocess, in-process transform registry
- **`packages/vite-plugin/src/resolve-transforms.ts`**: Delete (transforms loaded from instance)
- **`packages/showcase/`**: Consolidate theme.ts + custom-vocabulary.tsx into one ds.ts module

## Open Questions

- **TypeScript generic depth**: Threading `T` through 6 nested classes + type utilities creates deep generic instantiation chains. Will TypeScript hit its instantiation depth limit for complex themes? Need to spike with the showcase's theme (which has color modes, 6 scales, ~30 color tokens).
- **Default theme for `@animus-ui/ui`**: The existing `@animus-ui/ui` package uses the default `animus` instance without a custom theme. What's `T` for the default instance? Likely `BaseTheme` (minimal) — consumers augment by wrapping with their theme at the app level.
- **Backwards compatibility**: Existing consumers using `declare module` augmentation. Can we keep the global `Theme` interface as a deprecated fallback, or is this a clean break?
- **`createTheme` return type**: Does the ThemeBuilder's output type (`createTheme({...}).build()`) cleanly satisfy `BaseTheme`? It has `_variables`, `_tokens`, `mode` — non-scale keys that shouldn't appear in scale resolution.
- **Emotion interop**: The builder still uses `styled()` from Emotion at runtime. Emotion's `ThemeProvider` injects a theme via context. Does the co-located theme replace `ThemeProvider`, or coexist with it?
- **lodash.merge**: Currently used in variant accumulation. This is the right time to remove it — the builder is being refactored anyway.
