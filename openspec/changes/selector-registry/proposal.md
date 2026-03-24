## Why

The system has vocabulary for values (tokens) and CSS properties (prop registry), but no vocabulary for DOM targeting patterns. Component authors repeatedly write raw attribute selectors (`'&[data-state="open"]'`, `'&[disabled]'`, `'&[aria-expanded="true"]'`) — strings that are verbose, typo-prone, and inconsistent across components. Selectors need the same "register once, use everywhere" treatment that tokens and transforms already have.

## What Changes

- **New system builder method**: `.withSelectors()` registers a map of shorthand names to CSS attribute selectors. Sits alongside `.withTokens()` and `.withProperties()` as system-level vocabulary — not a cascade layer, not CSS emission.
- **Shorthand syntax in style objects**: `'&:open': { ... }` expands to `'&[data-state="open"]': { ... }` when `open` is a registered selector. Usable in any style position (`.styles()`, `.variant()`, `.states()`). The cascade layer is determined by WHERE the shorthand appears, not by the selector itself.
- **Extraction-time resolution**: The Rust crate and Vite plugin expand selector shorthands to full attribute selectors during CSS generation. Zero runtime cost.
- **Serialization**: `SerializedConfig` gains a `selectors` field carrying the registry to the extraction pipeline.
- **Type safety**: Registered selector names provide autocomplete in style object keys via `&:${keyof Selectors}` pattern.

## Capabilities

### New Capabilities
- `selector-registry`: System builder method for registering selector shorthands. Defines the registry API, shorthand expansion rules, type narrowing, and serialization contract.

### Modified Capabilities
- `system-builder`: Gains `.withSelectors()` in the builder chain. New generic parameter for selector names.
- `system-serialization`: `SerializedConfig` gains `selectors: Record<string, string>` field.
- `rust-extraction-pipeline`: Selector shorthand expansion during CSS generation — registered shorthands in style object keys resolved to full attribute selectors.
- `vite-extraction-plugin`: Passes selector registry from serialized config through to extraction pipeline.

## Impact

- **`packages/system/`**: `SystemBuilder` gains `.withSelectors()` method and `Selectors` generic parameter. `SerializedConfig` type gains `selectors` field.
- **`packages/extract/`**: CSS generation expands `&:name` keys to `&<registered-selector>` in emitted CSS. Selector map received as part of extraction config.
- **`packages/vite-plugin/`**: Passes selector registry from loaded system config to Rust extraction calls.
- **No runtime impact**: Selectors are resolved at extraction time. `createComponent` is unchanged.
- **No cascade changes**: `@layer base, variants, states, system` unchanged. Selectors are vocabulary, not layers.
