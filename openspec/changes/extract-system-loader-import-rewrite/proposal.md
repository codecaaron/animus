## Why

The shared system-loader's module rewriter concentrates unrelated import,
export, span-application, and trailing-export policies in one critical method.
Extracting the fully characterizable import-specifier branch gives that policy
one private owner and lowers review risk without changing either NAPI engine's
runtime behavior.

## What Changes

- Characterize every existing import-rewrite form through exact private output assertions.
- Extract import-specifier rendering into one private helper as specified in `design.md`.
- Keep exports, spans, dependency resolution, execution, public APIs, and dependencies unchanged.

## Capabilities

### New Capabilities

- `arch-system-loader-import-rewrite`: Executable architectural constraints for isolated, byte-stable system-loader import rewriting.

### Modified Capabilities

None.

## Impact

One private helper and colocated Rust characterization in
`packages/extract/crates/system-loader/src/lib.rs`; no public API, dependency,
manifest, engine phase, consumer, or deployment change.
