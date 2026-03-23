## Why

The Rust extraction pipeline reimplements 4 JS transform functions in Rust (`size`, `borderShorthand`, `gridItemRatio`, `gridItem` in `transforms.rs`). The config serialization maps JS function references to string identifiers, and the Rust side dispatches on those strings to call its reimplemented versions.

This architecture has three problems:

1. **Custom transforms don't extract.** If a user registers a custom transform in their config (`{ property: 'x', transform: myFn }`), the Rust pipeline has no way to apply it. The value either passes through raw or silently produces wrong CSS.

2. **Parity is fragile.** Every transform exists in TWO places (JS + Rust) and must produce identical output. The `serializeValueKey` parity contract between runtime and Rust is already a documented risk. Adding more transforms compounds it.

3. **New transforms require Rust changes.** Adding a 5th transform means writing Rust code, updating `transforms.rs`, updating the dispatch in `theme_resolver.rs`, rebuilding the NAPI addon. This is a barrier to design system extensibility.

The fix: transforms are JS functions defined in the config. They should RUN in JS at build time. The Rust pipeline extracts raw values and notes which transform applies. A JS post-processing step in the Vite plugin applies the transforms using the actual functions from the config. No reimplementation. No parity contract. Custom transforms just work.

## What Changes

- **Rust pipeline emits raw values for transformed props**: Instead of applying transforms during CSS generation, the Rust side emits a placeholder or intermediate representation for props with transforms. Known transforms can optionally still be applied in Rust as an optimization path.
- **Manifest includes transform metadata**: The `analyzeProject` manifest includes, for each transformed prop value, the raw value and the transform identifier. This metadata is consumed by the JS post-processing step.
- **Vite plugin post-processes CSS with transforms**: After receiving the manifest CSS from Rust, the plugin applies pending transforms using the actual JS functions from the config. This produces the final CSS.
- **Config serialization includes transform functions**: The serialized config passed to Rust includes transform identifiers. The Rust side uses them for dispatch (known transforms) or passthrough (unknown transforms).

## Capabilities

### New Capabilities
- `transform-interpolation`: The extraction pipeline supports arbitrary user-defined transform functions via build-time JS interpolation. Custom transforms registered in the config are applied to extracted CSS at build time without requiring Rust reimplementation.

### Modified Capabilities
- `rust-extraction-pipeline`: CSS generation emits intermediate values for transformed props. Known transforms remain as an optimization. Unknown transforms produce placeholder markers.
- `vite-extraction-plugin`: Post-processes manifest CSS to apply pending transforms using config-provided JS functions.

## Impact

- **`packages/extract/src/theme_resolver.rs`**: Modified to emit placeholders for unknown transforms
- **`packages/extract/src/transforms.rs`**: Retained as optimization, no longer load-bearing
- **`packages/extract/src/css_generator.rs`**: May need to emit transform metadata alongside CSS
- **`packages/vite-plugin/src/index.ts`**: Post-processing step after `analyzeProject`
- **`packages/core/src/config.ts`**: Config serialization may need to include transform function source or registry
- **No runtime changes**: Transforms are resolved at build time, not runtime
