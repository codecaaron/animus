## Why

The system has vocabulary for CSS properties (prop registry via `.addGroup()` / `.addProps()`) and theme values (token scales), but no vocabulary for DOM targeting patterns. Component authors repeatedly write raw attribute selectors (`'&[data-state="open"]'`, `'&[disabled]'`, `'&[aria-expanded="true"]'`) — strings that are verbose, typo-prone, and inconsistent across components. Selectors need the same "register once, use everywhere" treatment that props and tokens already have.

## What Changes

- **New builder method**: `.addSelectors()` registers a map of shorthand names to CSS selectors. Sits in the `createSystem()` chain alongside `.addGroup()` and `.addProps()` — vocabulary, not cascade layers, not CSS emission.
- **Shorthand syntax in style objects**: `'&:open': { ... }` expands to `'&[data-state="open"]': { ... }` when `open` is a registered selector. Usable in any style position (`.styles()`, `.variant()`, `.states()`, `.compound()`). The cascade layer is determined by WHERE the shorthand appears, not by the selector itself.
- **Extraction-time resolution**: The Rust crate and Vite plugin expand selector shorthands to full attribute selectors during CSS generation. Zero runtime cost.
- **Serialization**: `SerializedConfig` gains a `selectors` field carrying the registry to the extraction pipeline.
- **Type safety**: Registered selector names surface as autocomplete in style object keys via `&:${keyof SelectorReg}` — arbitrary string selectors remain valid, registered names appear as suggestions.

## Capabilities

### New Capabilities

- `selector-registry`: `.addSelectors()` on `SystemBuilder`. Defines the registry API, `&:name` shorthand expansion rules, type narrowing, and serialization contract.

### Modified Capabilities

- `system-builder`: Gains `.addSelectors()` in the builder chain and a third generic parameter `SelectorReg extends Record<string, string>`.
- `system-serialization`: `SerializedConfig` gains `selectors?: Record<string, string>` field.
- `rust-extraction-pipeline`: Selector shorthand expansion during CSS generation — `&:name` keys resolved to `&<registered-value>` in emitted CSS.
- `vite-extraction-plugin`: Passes selector registry from serialized config through to extraction pipeline.

## Impact

- **`packages/system/`**: `SystemBuilder` gains `.addSelectors()` and a third generic. `SerializedConfig` gains `selectors` field.
- **`packages/extract/`**: CSS generator expands `&:name` keys when a matching registered selector exists.
- **`packages/vite-plugin/`**: Passes selector registry from loaded system config to Rust extraction calls.
- **No runtime impact**: Selectors are resolved at extraction time. `createComponent` is unchanged.
- **No cascade changes**: `@layer global, base, variants, compounds, states, system, custom` unchanged. Selectors are vocabulary consumed BY layers.

## Notes

Replaces the archived 2026-03-29-selector-registry proposal, which referenced `.withSelectors()`, `.withProperties()`, and `.withGlobalStyles()` — all deleted in the `flatten-system-builder` refactor. The core idea is unchanged; only the builder API surface has been updated to match the current `.add*()` chain pattern.
