# Brainstorm: share V1 reconciler liveness policy

## Lead

RepoWise scores `packages/extract/src/reconciler.rs` at 5.23 and places its
change risk in the 93rd hotspot percentile. The file has a bus factor of one,
three dependents, no governing decision, and two separate implementations of
the same component-liveness rule: production reconciliation and dev-mode
prospective diagnostics both eliminate a component only when it is neither
rendered nor a provenance parent.

The lead is actionable, but the analyzer's larger complexity suggestion is too
broad for one safe increment. Canonical `css-reconciler` explicitly requires
dev/build agreement for component elimination, so centralizing only that
predicate is the smallest behavior-preserving seam with a concrete invariant.

## Evidence inspected

- Live file, its `reconcile()` and `identify_prospective_eliminations()` bodies,
  all fourteen local unit tests, and callers in `project_analyzer.rs`.
- Canonical `css-reconciler`, `usage-ledger`, and `project-analyzer` contracts.
- RepoWise context, risk, health, and rationale: no governing decision; the
  indexed evidence is committed `fd168798bbc4`, while this target is currently
  clean at `1c7f6c071896ce032146be473b01a3c26f606a862fc40d33c41a27704584a2fb`.
- Active non-archive OpenSpec search: no change owns `reconciler.rs`.

## Options

1. **One shared private liveness predicate plus a behavior matrix** — selected.
   It prevents actual/prospective policy drift without changing report or
   caller boundaries.
2. Split all four reconciliation phases into helpers. This is potentially
   useful but too large for the present evidence and would make review less
   independently revertible.
3. Share V1/V2 reconciliation code. Rejected: V1 remains the behavioral oracle,
   and no cross-engine co-change requirement is established.
4. Leave the duplicate rule in place and add only documentation. Rejected:
   documentation would not make the parity invariant compiler-visible.

## Selected falsifiable claim

One private predicate can own the rendered-or-parent liveness decision for
both actual and prospective elimination while preserving component order,
detail order/kinds, counts, conservative variant/state behavior, callers, and
all runtime oracles.
