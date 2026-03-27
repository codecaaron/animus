## Why

Every comparable CSS-in-JS framework (Stitches, Panda, Vanilla Extract, StyleX, Chakra) provides a way to generate a className without creating a React component. Animus requires `.asElement()` or `.asComponent()` — producing a React component even for one-off styles. This is a DX gap and unnecessarily couples all style output to React.

The key insight: we don't need a new API. The builder chain already encodes everything. We just need a new terminal — `.asClass()` — that outputs a callable function returning className strings instead of a React component.

## What Changes

- New terminal method `.asClass()` on the builder chain, available at all positions where `.asElement()` is available
- Always returns `(props?) => string` — a callable function that resolves to a className
- New runtime export `createClassResolver` — factored from existing `createComponent` logic, minus React.createElement
- Rust extraction recognizes `.asClass()` as a terminal, emits `createClassResolver()` calls instead of `createComponent()`
- CSS generation unchanged — same pipeline, same `@layer` assignment
- **Framework-agnostic** — `.asClass()` output has no React dependency

## Capabilities

### New Capabilities
- `as-class-terminal`: Builder chain terminal that produces a callable className resolver instead of a React component. Covers: return type, prop inference, runtime resolution, extraction transform, class naming, HMR.
- `class-resolver-runtime`: Standalone className resolution function extracted from createComponent. Covers: variant class lookup, state toggling, compound matching, system prop resolution — without React.

### Modified Capabilities
- `builder-chain`: New terminal method `.asClass()` added to all post-`.styles()` type-state positions alongside `.asElement()` and `.asComponent()`
- `rust-extraction-pipeline`: Chain walker recognizes `.asClass()` terminal; transform emitter produces `createClassResolver` calls
- `extraction-runtime-shim`: New export `createClassResolver` alongside existing `createComponent`

## Impact

- **system package**: New `createClassResolver` runtime function, `.asClass()` method on builder types (Animus.ts, AnimusExtended.ts)
- **extract crate**: `chain_walker.rs` (terminal recognition), `transform_emitter.rs` (emit shape)
- **Type system**: Return type inference for `.asClass()` based on chain generics
- **Consumer API**: Additive — no breaking changes. New terminal available on all chains.
- **React dependency**: `.asClass()` output is React-free, expanding addressable surface to non-React frameworks
