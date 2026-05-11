## Why

The system package (zero-runtime static extraction path) transitively depends on Emotion through the chain `system -> theming -> core -> @emotion/*`. This contaminates the dependency graph — consumers of `@animus-ui/system` pull in `@emotion/react`, `@emotion/styled`, and `@emotion/is-prop-valid` despite never using them. Theming's entire source is 4 Emotion-free files (~450 lines of pure TypeScript + lodash) that import only 3 trivial type definitions from core. The package boundary between theming and system is cosmetic — it predates the extraction architecture and no longer serves a purpose.

Additionally, `SystemBuilder.withTokens()` is unnecessary. Theme construction is a consumer concern — consumers build their theme separately via `createTheme()`, augment the `Theme` interface via module declaration, and export the tokens value. Module augmentation handles type drilling; SystemBuilder never needs the tokens or the `T` generic. The plugin loads tokens directly from module exports.

## What Changes

- **Absorb theming source into system**: Move theming's 4 source files (`createTheme.ts`, `serializeTokens.ts`, `flattenScale.ts`, `types.ts`) into `system/src/theme/`
- **Localize type definitions**: Add `AbstractTheme` and `CSSObject` to system's type surface (system already owns `BaseTheme` and `Breakpoints`)
- **Remove `withTokens()` from SystemBuilder**: Theme construction is not SystemBuilder's concern. The `T` generic, `#tokens` field, and `ThemeBuilderInput` type are removed. `serialize()` drops the `tokens` field.
- **Plugin loads tokens from module exports**: The subprocess looks for `m.tokens || m.theme` alongside `m.ds || m.default || m.system`. Tokens and system config travel as separate exports.
- **Re-export from system index**: `createTheme`, `ThemeBuilder`, `flattenScale`, `serializeTokens`, and associated types exported from `@animus-ui/system` (aligns with publishing surface plan)
- **Remove dependency**: Drop `@animus-ui/theming` from system's `package.json`
- **Theming package preserved**: The theming package itself is NOT deleted — it remains for the legacy core/Emotion path.

## Capabilities

### New Capabilities
- `theming-internalization`: Absorbing theming utilities (ThemeBuilder, createTheme, serializeTokens, flattenScale) into the system package as internal modules with locally-defined types

### Modified Capabilities
- `system-builder`: Remove `withTokens()` method, `T` generic, and `#tokens` field. SystemBuilder owns properties, groups, and global styles only. `serialize()` drops the `tokens` field.
- `system-serialization`: `serialize()` return type loses the `tokens` field.
- `vite-extraction-plugin`: Plugin subprocess loads tokens from a separate module export (`m.tokens || m.theme`) instead of from `ds.serialize().tokens`.

## Impact

- **system/package.json**: Removes `@animus-ui/theming` dependency. Zero transitive path to `@emotion/*`.
- **system/src/theme/**: New directory containing 4 moved files with updated imports.
- **system/src/types/theme.ts**: Gains `AbstractTheme` and `CSSObject` type definitions.
- **system/src/index.ts**: Gains re-exports for theming utilities.
- **SystemBuilder**: `withTokens()` removed. `T` generic removed. `serialize()` returns `{ propConfig, groupRegistry, transforms, globalStyles }` — no `tokens`.
- **Consumer API**: **BREAKING** — `createSystem().withTokens(cb)` removed. Consumers build and export tokens separately.
- **Showcase `ds.ts`**: Removes `.withTokens(() => tokens)` from the chain. Exports `tokens` as a named export. Imports `createTheme` from `@animus-ui/system` instead of `@animus-ui/theming`.
- **Vite plugin**: Subprocess updated to load `tokens` from module exports. `evaluateThemeObject` call unchanged.

## Progression

This is change 1 of 2. Change 2 (`animus-provider`) will add `AnimusProvider` to `@animus-ui/react` as a typed import-anchor for distributed design system consumption.
