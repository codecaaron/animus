# Brainstorm: flatten V1 variant argument routing

## Lead

RepoWise scores `packages/extract/src/style_evaluator.rs` at 4.58 and places
its change risk in the 97th hotspot percentile. The top bounded finding is the
seven-level nesting in `parse_variant_arg()`. The file has four dependents, a
bus factor of one, and no governing decision.

The finding is valid. The public parser walks a config object, ignores non-
property entries and wrong-typed known fields, preserves structural errors from
property-key/style evaluation, accumulates option maps across repeated
`variants` fields, and returns skip warnings in evaluation order. The safe
improvement is to express typed top-level routing as one match and move option
collection into one private helper.

## Evidence inspected

- Live `parse_variant_arg()`, its sole V1 caller, neighboring evaluator
  helpers/tests, and the V2 compatibility port in `eval.rs`.
- Canonical `rust-extraction-pipeline/Static style evaluation` and
  `per-property-bail` contracts for skip versus structural-bail behavior.
- RepoWise context/risk/why: 97th-percentile hotspot risk, four dependents,
  no governing decision, committed index `fd168798bbc4`.
- Active non-archive OpenSpec search and target status: no change owns the
  clean `style_evaluator.rs` footprint.

## Options

1. **Typed tuple match plus private option collector** — selected. It flattens
   both nesting axes while keeping evaluation order and result shape.
2. Only replace the outer `if let` with `let ... else`. Rejected: it leaves the
   deepest `variants` branch and most of the finding intact.
3. Generalize variant and states parsing behind shared abstractions. Rejected:
   their result shapes and error semantics differ, and no second consumer
   requires a common policy.
4. Share the V1 and V2 implementation. Rejected: V1 is the behavioral oracle,
   not a shared-code target; the engines preserve local evaluation phases.

## Selected falsifiable claim

One private option collector plus one typed top-level match can preserve prop,
default, base, ordered option keys, repeated-option override, ignored config-
container entries, bailing style-object errors, and skip-order behavior while
removing the deeply nested decision tree from `parse_variant_arg()`.
