## Why

Style values that compose multiple CSS tokens — borders, shadows, gradients, shorthand properties — cannot currently reference design system tokens inline. A developer writing `border: '1px solid primaryColor'` must either hard-code the CSS variable name (`var(--colors-primary)`) or abandon extraction for that property. Token alias syntax (`{colors.primary}`) gives developers a compile-time shorthand that resolves to the correct CSS variable or literal value during extraction, using the same lodash `_.get()` dot-path convention the runtime already uses for scale lookups. The `/N` alpha modifier (`{colors.primary/50}`) solves the long-standing color-with-opacity problem via CSS-native `color-mix()`.

## What Changes

- New `{scale.path}` syntax recognized inside string literal style values during Rust extraction
- New `{scale.path/N}` alpha modifier syntax producing `color-mix(in srgb, var(...) N%, transparent)`
- Theme serializer (`theme-evaluator.ts`) augmented to emit a variable-name map alongside the existing flat value map, built from `theme._variables`
- Rust `theme_resolver.rs` extended with token alias resolution: string scanning, dot-path-to-flat-key conversion, variable lookup, alpha interpolation
- Rust `style_evaluator.rs` updated: string literals containing `{...}` patterns are still classified as static (not bailed/skipped)
- No runtime changes — token alias is purely a compile-time feature
- No breaking changes to existing API — bare values on known props (`p: 8`, `color: 'primary'`) continue to use the existing implicit scale lookup

## Capabilities

### New Capabilities
- `token-alias-syntax`: Compile-time `{scale.path}` reference syntax in string style values, including alpha modifier, dot-path resolution, and variable-name-aware theme lookup

### Modified Capabilities
- `rust-extraction-pipeline`: Static style evaluation must recognize `{...}` patterns in string literals as resolvable (not skip/bail). Theme resolver gains token alias resolution alongside existing scale resolution.
- `vite-extraction-plugin`: Theme serializer must emit a variable-name map (`token_path → css_variable_name`) in addition to the existing flat value map.

## Impact

- **Rust crate** (`packages/extract/`): `theme_resolver.rs` gains new resolution path; `style_evaluator.rs` string handling unchanged but downstream consumers must handle alias markers; `lib.rs` deserialization updated for new theme format
- **Vite plugin** (`packages/vite-plugin/`): `theme-evaluator.ts` builds and serializes variable-name map from `theme._variables`; plugin passes augmented theme JSON to Rust
- **Theme package** (`packages/theming/`): No changes — `_variables` and `_tokens` already exist on the theme object
- **Core package** (`packages/core/`): No changes — prop config unchanged
- **Browser target**: `color-mix()` requires modern browsers (Chrome 111+, Firefox 113+, Safari 16.2+). If the project has an older browser floor, alpha interpolation needs a fallback strategy.
