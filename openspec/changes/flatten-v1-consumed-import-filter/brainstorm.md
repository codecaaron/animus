# Brainstorm: flatten V1 consumed-import filtering

## Lead

RepoWise scores `packages/extract/src/transform_emitter.rs` at 5.23 and places
its change risk in the 98th hotspot percentile. The top bounded finding is the
five-level nesting in `strip_consumed_imports()`. The file has eight dependents,
a bus factor of one, and no governing decision.

The finding is valid, but the line-based policy is intentional: canonical
`rust-extraction-pipeline` requires removal only when every binding in a named
import from a consumed source was extracted, while partial imports and all
other source text remain unchanged. The safe improvement is to separate that
decision from the newline-preserving loop, not redesign import parsing.

## Evidence inspected

- Live `strip_consumed_imports()`, `parse_named_import()`, its two direct unit
  contracts, `apply_replacements()` callers, and the V2 compatibility copy.
- Canonical `rust-extraction-pipeline/Source replacement` scenarios and the
  archived origin decision that chose conservative all-bindings removal.
- RepoWise context/risk/why: 98th-percentile churn risk, eight dependents, no
  governing decision, committed index `fd168798bbc4`.
- Active non-archive OpenSpec search: no change owns `transform_emitter.rs`.

## Options

1. **Private decision helper plus a line-shape matrix** — selected. It flattens
   the loop while preserving the exact parser and newline behavior.
2. Replace line parsing with OXC import analysis. Rejected: behavior and scope
   expansion without a failing multiline-import contract.
3. Prune only extracted specifiers from partial imports. Rejected: canonical
   policy deliberately preserves the whole partial import.
4. Share the V1 and V2 implementation. Rejected: V1 is the behavioral oracle,
   not a shared-code target; the engines have distinct assembly phases.

## Selected falsifiable claim

One private predicate can decide whether a line is a fully consumed named
import while `strip_consumed_imports()` remains solely responsible for stable
line order and trailing-newline restoration. Full target imports disappear;
partial, non-target, and import-looking non-import lines remain byte-stable.
