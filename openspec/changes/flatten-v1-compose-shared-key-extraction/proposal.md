# Proposal: flatten V1 compose shared-key extraction

## Why

The V1 compose scanner nests property-kind filtering, key evaluation,
`shared` routing, object validation, inner-property filtering, and key
collection inside one private helper. The shape obscures compatibility behavior
in a high-risk, single-owner file.

## What changes

- Characterize outer abort/skip behavior, wrong-typed and duplicate `shared`
  properties, inner unresolvable-expression skips, computed string/numeric
  literal keys, and source order through compose family extraction.
- Replace nested outer branches with `let ... else` and early `continue` guards.
- Collect inner shared keys with one source-ordered `filter_map`.
- Capture the V1-local compose parsing boundary in OODA artifacts.

## What does not change

- No public type/signature, caller, family record, slot/context/name behavior,
  diagnostic, manifest, runtime output, or V2 source.
- No generic compose-options reader and no change to the existing top-level
  unresolvable-key abort policy.

## Capability

- ADDED: `arch-extract-v1-compose-shared-keys` — flat, engine-local V1
  extraction of compose shared keys.

## Impact

- Source: `packages/extract/src/jsx_scanner.rs` only.
- Verification: strict OODA validation and mapped V1 Clippy, Rust units, NAPI
  canary, and integration.
- Risk: near-99th-percentile hotspot file, mitigated by direct characterization,
  structural RED, V2/dirty hashes, and independent two-phase review.
