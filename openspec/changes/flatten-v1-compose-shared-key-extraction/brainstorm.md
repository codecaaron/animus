# Brainstorm: flatten V1 compose shared-key extraction

## Lead

RepoWise scores `packages/extract/src/jsx_scanner.rs` at 4.98 and places its
change risk near the 99th hotspot percentile. The bounded critical finding is
the seven-level nesting in `extract_shared_keys()`. The file has six dependents,
a bus factor of one, and no governing decision.

The finding is valid, but its semantics are asymmetric. Top-level spreads are
ignored; an unresolvable top-level property key aborts extraction; a wrong-
typed `shared` property is skipped in favor of a later one; the first valid
object-valued `shared` property wins; inner spreads and unresolvable keys are
ignored; and string/numeric keys retain source order regardless of values.

## Evidence inspected

- Live helper, sole caller `extract_compose_family()`, key evaluator,
  neighboring `context`/`name` readers, direct compose tests, and the V2
  compatibility implementation in `crates/extract-v2/src/jsx_scan.rs`.
- Canonical compose-family extraction and slot-composition contracts.
- RepoWise context/risk/why: near-99th-percentile hotspot risk, six dependents,
  single-owner concentration, no governing decision, committed index
  `fd168798bbc4`.
- Active non-archive OpenSpec search and target status: no change owns the clean
  `jsx_scanner.rs` footprint.

## Options

1. **Flat outer guards plus inner `filter_map`** — selected. It retains the
   outer `?` abort while expressing skip/continue paths directly.
2. Extract one generic compose-options property reader shared with `context`
   and `name`. Rejected: those readers skip unresolvable keys rather than abort,
   so sharing would hide incompatible policies.
3. Replace the whole function with nested `find_map` calls. Rejected: a naive
   iterator rewrite changes abort versus skip and wrong-type duplicate behavior.
4. Share the V1 and V2 implementation. Rejected: V1 is the behavioral oracle,
   not a shared-code target; the engines preserve local AST phases.

## Selected falsifiable claim

Two flat outer guards and one inner `filter_map` can preserve abort, skip,
duplicate, key-kind, and source-order behavior while removing the deeply nested
decision tree from V1 `extract_shared_keys()`.
