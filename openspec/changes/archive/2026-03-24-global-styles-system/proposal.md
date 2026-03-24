## Why

Global styles (resets, base typography, scrollbar customization, selection colors) are currently hand-written CSS files imported separately from the design system. This means they can't use prop shorthand (`p: 8`), scale lookups (`color: 'primary'`), or transforms (`border: 1`) — the vocabulary the rest of the system provides. Every global style is a hand-maintained escape hatch that bypasses the design language. A `.withGlobalStyles()` method on the system builder makes global CSS first-class: authored with the same shorthand, resolved through the same theme, extracted through the same pipeline.

## What Changes

- New `.withGlobalStyles()` method on `SystemBuilder` accepting a CSS-selector-keyed object where values are style objects using the same prop shorthand as components
- `SerializedConfig` gains a `globalStyles` field containing the raw global style declarations (selector → style object map)
- The Rust extraction pipeline resolves global style objects through the existing theme resolver (scale lookups, transforms, token aliases) and emits CSS outside any `@layer` block (or in a dedicated `@layer global`)
- The Vite plugin prepends resolved global CSS to the virtual stylesheet alongside theme variable CSS
- Showcase replaces `global.css` and `reset.css` imports with `.withGlobalStyles()` on the system instance

## Capabilities

### New Capabilities
- `global-styles-system`: System builder method for defining global CSS with prop shorthand, theme resolution, and transform support. Serialized and extracted alongside component styles.

### Modified Capabilities
- `vite-extraction-plugin`: Plugin prepends resolved global CSS to the virtual stylesheet, emitted before component `@layer` blocks.
- `custom-instance-extraction`: System `serialize()` includes `globalStyles` field in its output.

## Impact

- **System package** (`packages/system/`): `SystemBuilder` gains `.withGlobalStyles()`, `SerializedConfig` gains `globalStyles` field, `serializeInstance` includes global styles in output
- **Vite plugin** (`packages/vite-plugin/`): `loadSystem()` reads `globalStyles` from serialized config, resolves through the Rust pipeline or JS-side resolution, prepends to virtual CSS
- **Rust crate** (`packages/extract/`): May need a new entry point or reuse existing `resolve_styles` for global style resolution (selector-keyed objects instead of component chains)
- **Showcase** (`packages/showcase/`): `global.css` and `reset.css` replaced by `.withGlobalStyles()` on the `ds` instance
