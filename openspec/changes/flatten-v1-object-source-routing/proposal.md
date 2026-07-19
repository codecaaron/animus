## Why

V1 object-source parsing currently hides four distinct compatibility outcomes
inside six levels of nested conditionals. Flattening that private routing seam
after directly characterizing its values, skips, captures, and exact errors
makes the code safer to review without changing extraction behavior.

## What Changes

- Characterize literal-object, static-identifier, identifier-error, and generic-error routes through the private V1 helper.
- Replace the nested source-shape routing with explicit structural guards and one expression-kind decision as specified in `design.md`.
- Keep callers, diagnostics, NAPI behavior, dependencies, and V2 facts extraction unchanged.

## Capabilities

### New Capabilities

- `arch-extract-v1-object-source-routing`: Executable architectural constraints for flat, engine-local V1 object-source routing.

### Modified Capabilities

None.

## Impact

One private helper and colocated Rust characterization in
`packages/extract/src/lib.rs`; no public API, dependency, manifest, V2,
consumer, or deployment change.
