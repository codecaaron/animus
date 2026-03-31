## Why

The ThemeBuilder destroys raw input shapes at storage time — `flattenScale()` collapses nested color objects into flat dash-joined key maps, `serializeTokens()` replaces values with `var()` references, and `resolveThemeTokenRefs()` mutates `_tokens` in-place. This makes theme composition impossible: a library theme is a sealed object whose original inputs cannot be recovered. The dash-join format (`gray-50`) leaks from CSS custom property naming into the internal API, creating a format that's neither the user's nested input nor standard JS path notation. The only consumers of the flattened form are `serialize()` and manifest assembly — build-time one-shots. In the extraction world, no component touches theme values at runtime.

## What Changes

- **Nested internal storage** — `addColors`, `addScale`, `addColorModes` store raw nested inputs as-is. No `flattenScale()` at storage time.
- **Dot-path as internal separator** — All user-facing token references use `.` (dot-path): mode aliases (`'gray.50'`), token refs (`{colors.gray.50}`), manifest keys (`'colors.gray.50'`). The dash-join (`-`) exists only at the CSS serialization boundary (`--color-gray-50`).
- **`addBreakpoints()` method** — `createTheme()` takes no arguments. Breakpoints move to a builder method.
- **Type-state chain ordering** — Builder enforces dependency ordering via type narrowing: breakpoints → colors → modes → scales → contextualVars. Matches the component builder's cascade ordering pattern.
- **`.from(libTokens)` composition** — New builder method seeds from a built theme with deep merge semantics. Advances type-state to extension mode where all `add*` methods augment.
- **`varRef(tokenPath)`** — Non-enumerable escape hatch for on-demand `var()` lookup. Takes dot-path, returns `var(--dash-join-name)`.
- **Terminology alignment** — `declareContextualVars` (was `addContextualVars`), `extendScale` (was `updateScale`), `ds.toConfig()` (was `ds.serialize()`).
- **Supersedes theme-unpack** — The composition problem dissolves when nested IS the internal form.

## Capabilities

### New Capabilities

- `nested-theme-representation`: Theme builder stores raw nested inputs internally, uses dot-path as the internal separator, enforces type-state chain ordering, and flattens only at serialization boundaries.
- `theme-composition`: `.from(libTokens)` composition entry point plus direct property spreading for selective composition.

### Modified Capabilities

- `theme-variable-emission`: serialize() and manifest flatten from nested storage. CSS output uses dash-join names (unchanged). Internal paths use dot-path.
- `system-serialization`: `tokens.serialize()` unchanged. `ds.serialize()` renamed to `ds.toConfig()` for disambiguation.

## Impact

- `packages/system/src/theme/createTheme.ts` — ThemeBuilder internals: type-state classes, nested storage, dot-path traversal, `from()`, `flattenTheme()` at build boundary
- `packages/system/src/types/theme.ts` — Theme type shape: nested types, `LiteralPaths` with `.` separator, `EmittedScales` via type param
- `packages/system/src/SystemBuilder.ts` — `serialize()` → `toConfig()` rename
- `packages/system/src/index.ts` — Export changes: `flattenScale`/`serializeTokens` go internal, terminology renames
- `packages/system/__tests__/theme.test.ts` — All snapshots update, new type-state and composition tests
- `packages/showcase/src/ds.ts` — `createTheme()` signature, mode alias syntax dot-path, token ref syntax dot-path
- `packages/test-ds/src/system.ts` — Same signature change
- `packages/vite-plugin/` — `ds.serialize()` → `ds.toConfig()` call sites
- `packages/next-plugin/` — Same rename
- Rust crate token ref parser may need dot-path splitting update (downstream cleanup)
