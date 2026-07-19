# Proposal: flatten V1 consumed-import filtering

## Why

The emitter's dead-import loop nests recognition, parsing, source membership,
and all-bindings checks in one block. That makes a small conservative policy
harder to review in a high-churn, single-owner file.

## What changes

- Add one private predicate that recognizes a fully consumed named import.
- Make the line-preserving loop use an early `continue` from that predicate.
- Add one characterization matrix for full, partial, non-target, and
  import-looking non-import lines with no trailing newline.
- Capture the conservative policy and V1-local boundary in OODA artifacts.

## What does not change

- No public emitter API, caller, parse rule, import-source policy, binding
  semantics, line order, trailing newline, runtime output, or V2 source.
- No AST-based multiline-import support or partial-specifier rewriting.

## Capability

- ADDED: `arch-extract-v1-consumed-import-filter` — private V1 decision routing
  for conservative consumed-import removal.

## Impact

- Source: `packages/extract/src/transform_emitter.rs` only.
- Verification: strict OODA validation and mapped V1 Clippy, Rust units, NAPI
  canary, and integration.
- Risk: 98th-percentile file, mitigated by exact V2/dirty hashes, GREEN→GREEN
  characterization, and independent two-phase review.
