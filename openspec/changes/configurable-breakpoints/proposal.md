## Why

Breakpoints are the only part of the theme that is hardcoded rather than user-defined. The `Breakpoints` interface mandates exactly `{ xs, sm, md, lg, xl }` — consumers cannot add, remove, or rename breakpoints. The responsive array syntax (`p={[8, 12, , 16]}`) couples positional indices to this fixed set, making the system fragile. Meanwhile, the rest of the theme (scales, colors, color modes) is fully configurable via `createTheme()`. Breakpoints should follow the same pattern: user-defined keys, system-inferred types.

## What Changes

- **BREAKING**: Remove responsive array syntax (`p={[default, xs, sm, md, lg, xl]}`). Only object syntax remains (`p={{ _: 8, md: 16 }}`).
- **BREAKING**: Replace the fixed `Breakpoints<T>` interface (`{ xs, sm, md, lg, xl }`) with an unconstrained `Record<string, T>`. User-defined keys flow through the augmented `Theme` interface.
- `MediaQueryMap<T>` becomes a mapped type derived from `Theme['breakpoints']` instead of hardcoding 5 keys.
- `MediaQueryArray<T>` and `MediaQueryByKey<T>` are removed entirely.
- Runtime breakpoint resolution (`createMediaQueries`, `createStylist`, `objectParser`) derives keys dynamically from the theme object.
- Rust extraction's `is_responsive_value()` receives breakpoint keys from the serialized theme instead of using a hardcoded constant.
- `createTheme()` accepts any `Record<string, number>` for breakpoints — the keys become the responsive prop API.

## Capabilities

### New Capabilities
- `configurable-breakpoints`: User-defined breakpoint keys flow through types, runtime, and extraction. The responsive prop object syntax accepts exactly the keys defined in `createTheme({ breakpoints: {...} })`.

### Modified Capabilities
- `prop-system`: Responsive syntax changes — array syntax removed, `ResponsiveProp<T>` simplified to `T | MediaQueryMap<T>` where `MediaQueryMap` is derived from theme breakpoints.
- `rust-extraction-pipeline`: `is_responsive_value()` detection uses theme-provided keys instead of hardcoded constant.

## Impact

- **Types** (`system/src/types/theme.ts`, `system/src/types/props.ts`, `core/src/types/theme.ts`, `core/src/types/props.ts`): Interface definitions rewritten. `Breakpoints` becomes unconstrained, `MediaQueryMap` becomes mapped type, array types removed.
- **Runtime** (`core/src/styles/responsive.ts`, `core/src/styles/createStylist.ts`, `core/src/styles/createParser.ts`): Hardcoded key arrays replaced with dynamic theme-derived iteration. `arrayParser` removed entirely.
- **Rust** (`extract/src/theme_resolver.rs`): `BREAKPOINT_KEYS` constant removed, `is_responsive_value()` accepts breakpoint keys as a parameter from the serialized theme.
- **Theming** (`theming/src/core/ThemeBuilder.ts`, `system/src/theme/createTheme.ts`): Generic constraint relaxed from `extends Breakpoints` to `extends Record<string, number>`.
- **Consumer code**: Any responsive array syntax (`p={[8, 12, , 16]}`) must migrate to object syntax (`p={{ _: 8, sm: 12, lg: 16 }}`). Existing object syntax is unaffected as long as key names don't change.
- **Showcase**: Replace any responsive arrays in fixtures/tests. Update `compatTheme` defaults if retained.
