# LEGACY — this package is archived. See root CLAUDE.md § Legacy Packages.

# @animus-ui/theming — Legacy Theme Builder

**Status: Legacy.** Consumers use `createTheme` and `ThemeBuilder` from `@animus-ui/system`, which contains its own implementation. Do not add new API surface here — extend system instead.

## What This Package Is

ThemeBuilder fluent API for defining design tokens and their CSS variable bindings. System re-exports `createTheme`, `ThemeBuilder`, `flattenScale`, and `serializeTokens`.

## Emission Tracking

Not all scales produce CSS variables. The distinction matters for extraction:

- `addColors({...})` — always emits CSS variables (`--color-primary`, etc.)
- `addScale({ name, values, emit: true })` — opts into CSS variable emission
- `addScale({ name, values })` — raw values only, no CSS variables

The `Emitted` generic parameter accumulates through the builder chain, tracking which scales have CSS variables. This powers `EmittedScales<T>` and `EmittedTokenPaths<T>` — used to validate `{scale.key}` token references at the type level.

## serialize() Output

`tokens.serialize()` produces the `SerializedTheme` consumed by the extraction pipeline:

| Field | Content | Consumer |
|-------|---------|----------|
| `scalesJson` | Flattened `"scale.key" → "value"` | Rust theme_resolver |
| `variableMapJson` | `"colors.primary" → "--color-primary"` | Rust token alias resolution |
| `variableCss` | `:root { --color-*: ... }` declarations | Vite plugin virtual module |
| `contextualVarsJson` | Per-scale contextual var names | Rust contextual resolution |
