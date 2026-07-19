# Brainstorm: split V1 layer-content routing

## Lead

RepoWise scores `packages/extract/src/css_generator.rs` at 4.78 and places its
change risk near the 99th hotspot percentile. The bounded high-impact finding is
the six-level nesting and cognitive complexity in `generate_layer_content()`.
The file has five dependents, a bus factor of one, and no governing decision.

The finding is valid. The function combines layer dispatch, component walking,
selector construction, default-variant lookup, and rule emission in one nested
decision tree. Its public caller requests each of the four layers separately,
so one top-level dispatch to four private emitters can expose the existing phase
boundary without changing traversal or CSS.

## Evidence inspected

- Live `generate_layer_content()`, `generate_css()`, rule-writing neighbors,
  direct Rust tests, canary/integration references, and the V2 compatibility
  implementation in `crates/extract-v2/src/css.rs`.
- Canonical CSS generation, variant-sublayer, structured-sheet, and layer
  delivery contracts. The older `rust-extraction-pipeline` layer-order example
  is stale relative to current `anm-` naming and the compounds layer; this
  increment preserves live behavior and does not rewrite that broader spec.
- RepoWise context/risk/why: near-99th-percentile hotspot risk, five dependents,
  single-owner concentration, no governing decision, committed index
  `fd168798bbc4`.
- Active non-archive OpenSpec search and target status: no change owns the clean
  `css_generator.rs` footprint.

## Options

1. **Top-level dispatch to four private layer emitters** — selected. Each
   helper owns one existing selector/traversal policy and writes to the shared
   output buffer in the same order.
2. Move the current match into one per-component router helper. Rejected: it
   relocates the same mixed decision tree and leaves variant traversal nested
   under generic routing.
3. Normalize every layer into a boxed iterator of `(selector, styles)` rules.
   Rejected: trait-object allocation and lifetime machinery add cost and
   abstraction with no additional consumer.
4. Share the V1 and V2 implementation. Rejected: V1 is the behavioral oracle,
   not a shared-code target; the engines preserve local CSS phases.

## Selected falsifiable claim

One top-level `LayerKind` match plus four private emitters can preserve exact
inter-component order, base content, ordered options, matching-default
sidecars, absent/unmatched-default omission, compound indices, and ordered
state CSS while removing component-loop dispatch from
`generate_layer_content()`.
