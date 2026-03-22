## Why

The Animus builder chain produces fully typed React components: variant props are narrowed to declared options, system props are typed against the prop config, state props are boolean-only. TypeScript catches `<Button variant="typo">` at compile time.

After extraction, the chain is replaced with `createComponent('button', className, config)` which returns `AnimusComponent` — typed as `ReturnType<typeof forwardRef> & { extend: () => never }`. This accepts ANY props. All variant narrowing, system prop types, and state prop constraints are erased. TypeScript no longer warns on misuse.

This is a regression that TypeScript-heavy teams will reject. The type system is the core value proposition of the builder chain API — extraction must preserve it.

## What Changes

- **Generic `createComponent` signature**: The runtime shim's `createComponent` gains type parameters that reconstruct the component's prop interface from the extraction config.
- **Type assertion in transform output**: The Rust transform emits a type annotation that preserves the original component's prop interface, so the extracted binding has the same TypeScript type as the pre-extraction binding.
- **Approach options**: (a) `as typeof OriginalBinding` assertion using a preserved type-only import, (b) a generated interface from the manifest's variant/state/system prop data, or (c) a TypeScript declaration file emitted alongside the transform.

## Capabilities

### Modified Capabilities
- `extraction-runtime-shim`: `createComponent` gains generic type parameters
- `rust-extraction-pipeline`: Transform output includes type annotation preserving original prop types

## Impact

- **`packages/runtime/src/index.ts`**: Generic createComponent signature
- **`packages/extract/src/transform_emitter.rs`**: Emit type assertion or type parameters in replacement code
- **Developer experience**: `<Button variant="typo">` remains a TypeScript error after extraction
