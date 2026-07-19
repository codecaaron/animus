# Proposal: flatten V1 variant argument routing

## Why

The V1 variant parser nests object-entry filtering, key routing, value-type
checks, option iteration, style evaluation, skip aggregation, and map insertion
inside one public function. That obscures a stable compatibility policy in a
high-risk, single-owner file.

## What changes

- Characterize variant config shape, ignored config-container entries, ordered
  option keys, repeated-option overrides, style-object structural bails, and
  skip order directly against `parse_variant_arg()`.
- Add one private helper for variant-option collection.
- Route top-level known fields through one `(key, value)` match after an early
  non-property guard.
- Capture the V1-local compatibility boundary in OODA artifacts.

## What does not change

- No public type/signature, caller, evaluator, key parser, error/skip behavior,
  config field, option ordering/override rule, manifest, runtime output, or V2
  source.
- No static-identifier support for variant arguments or variant/states
  abstraction.

## Capability

- ADDED: `arch-extract-v1-variant-argument-routing` — flat, engine-local V1
  routing for variant config evaluation.

## Impact

- Source: `packages/extract/src/style_evaluator.rs` only.
- Verification: strict OODA validation and mapped V1 Clippy, Rust units, NAPI
  canary, and integration.
- Risk: 97th-percentile hotspot file, mitigated by exact V2/dirty hashes,
  GREEN-to-GREEN characterization, and independent two-phase review.
