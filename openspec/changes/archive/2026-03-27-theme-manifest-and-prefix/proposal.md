## Why

The ThemeBuilder's `.build()` output is an opaque object that discards structured metadata about which tokens are CSS variables, what their variable names are, and how modes map to values. The Vite plugin reconstructs this information by re-flattening the entire theme and pattern-matching `var(...)` strings — a fragile heuristic that should be authoritative data flowing from builder to plugin. Additionally, there's no namespace prefix support, making multi-library composition collision-prone (`--color-primary` from two libraries will collide). Layer names are hardcoded with no way for consumers to integrate Animus layers into their own cascade architecture. Raw color values lack validation, allowing arbitrary strings where CSS color literals are expected.

## What Changes

- **ThemeBuilder manifest output**: `.build()` produces a `ThemeManifest` accessible via a `.manifest` property on the built theme object. The manifest contains: flat token map (key→raw value), variable map (key→CSS variable name), mode definitions (mode→key→value), and pre-built variable CSS. This is the **single source of truth** that the plugin passes to Rust — no reconstruction. The `.build()` return type is **unchanged** — `typeof tokens` and module augmentation patterns are not affected.
- **Plugin consumes manifest directly**: `evaluateThemeObject()` reads the manifest instead of re-flattening and scanning for `var(...)` patterns. The `scalesJson`, `variableMapJson`, and `variableCss` are derived from manifest data, not reverse-engineered. **BREAKING** internal contract between ThemeBuilder and plugin (not consumer-facing). Rust FFI consolidates three JSON string parameters into a single `manifestJson` parameter.
- **Namespace prefix config**: Plugin accepts a `prefix` option. Flows into three outputs: CSS variable names (`--{prefix}-color-primary`), class names (`.{prefix}-Button-hash`), and layer names (`{prefix}-base`, `{prefix}-variants`, etc.). Applied at extraction time in Rust, not in ThemeBuilder. No prefix = current behavior unchanged.
- **Consumer-controlled layer declaration**: Plugin accepts an optional `layers` array — the full `@layer` declaration including both Animus layers (prefixed) and consumer layers interleaved. The plugin validates at init that Animus's 6 internal layers appear in the correct relative order (`global < base < variants < states < system < custom`) — the cascade contract is enforced, but consumers can slot their own layers before, after, or between. Without `layers` config, current hardcoded declaration is emitted.
- **Color value validation**: `addColors()` validates that raw color values are CSS `<color>` literals (hex, rgb/rgba, hsl/hsla, oklch, oklab, named CSS colors, `transparent`, `currentColor`). Rejects gradients, objects, or arbitrary strings. Type-level constraint uses template literal union with `(string & {})` escape hatch for future CSS color functions. `addColorModes()` validates that alias values reference keys that exist in the current color palette. Both throw descriptive errors (including the failing key name) at build time.

## Capabilities

### New Capabilities
- `theme-manifest`: Structured manifest output from ThemeBuilder containing token map, variable map, mode definitions, and variable CSS as authoritative data. Opaque type (no generics). Accessible via `.manifest` property on built theme.
- `namespace-prefix`: Configurable prefix for CSS variable names, class names, and layer names to prevent multi-library collisions. Consumer-controlled layer declaration with enforced internal ordering.

### Modified Capabilities
- `theme-variable-emission`: Variable CSS generation moves from plugin heuristic to manifest-driven. evaluateThemeObject return shape changes to consume manifest directly.
- `vite-extraction-plugin`: Plugin gains `prefix` and `layers` options. Theme evaluation consumes manifest instead of re-flattening. Rust FFI consolidates to single manifest parameter.

## Impact

- **`packages/system/src/theme/createTheme.ts`**: ThemeBuilder assembles manifest during `.build()`, exposes via `.manifest` property. Color validation in `addColors()` and `addColorModes()`.
- **`packages/system/src/types/theme.ts`**: New opaque `ThemeManifest` interface exported. Color value type constraint on `addColors()`.
- **`packages/vite-plugin/src/theme-evaluator.ts`**: `evaluateThemeObject()` rewritten to read manifest. Eliminates `var()` pattern-matching and re-flattening code paths.
- **`packages/vite-plugin/src/index.ts`**: New `prefix` and `layers` options in `AnimusExtractOptions`. Layer order validation at `configResolved`. Prefix and layer names passed to Rust.
- **`packages/extract/src/`**: Rust crate receives consolidated manifest JSON + prefix. Prefix applied to class name generation and token alias resolution (variable map pre-prefixed before resolution loop). Layer names received from plugin config instead of hardcoded.
- **`packages/showcase/src/ds.ts`**: No changes needed — consumer API unchanged.
