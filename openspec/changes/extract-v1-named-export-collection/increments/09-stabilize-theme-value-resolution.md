# Increment 09: stabilize V1 theme-value resolution

**Goal:** Cover the registered evaluator path directly and make V1 scale,
transform, fallback, and negative-value ownership legible without changing
consumer output.

## Implemented value

- [x] Added one eight-row direct matrix for evaluator success/error, scale hit
  and miss, no-scale and empty-array eligibility, and negative integer/f64
  behavior.
- [x] Extracted negative lookup normalization and transform resolution into two
  private helpers; `resolve_value()` is now a 29-line coordinator.
- [x] Preserved legacy placeholder bytes, evaluator-error raw fallback,
  integer/f64 representation, deferred negation, public contracts, and V2.

## Evidence

- Registered-evaluator matrix: 1/1; existing scale/placeholder matrices: 2/2.
- Strict Clippy: pass.
- Rust units: 644 passed, 1 ignored, 0 failed (`287 + 9 + 348`).
- Canary: exact stale-NAPI remediation completed; 200/200, 4 snapshots, 432
  expectations.
- Integration: 157/157 across 11 files.
- Target diff-check: empty; broad pre-existing Rustfmt drift was not absorbed.
- Independent review: CLEAN.

## Completion

- **Status:** complete; D22/G16 are satisfied.
- **Review cadence:** one implementer, one reviewer, and one mapped verification
  cycle at the source-bundle boundary; cockpit artifacts were written afterward.
- **Residuals:** no adjacent theme, DRY, file-split, or V2 cleanup was activated.
