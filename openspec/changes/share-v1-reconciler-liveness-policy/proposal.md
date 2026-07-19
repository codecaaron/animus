# Proposal: share V1 reconciler liveness policy

## Why

Production pruning and dev-mode prospective diagnostics currently duplicate a
two-part component-liveness condition. That condition is an observable parity
boundary: if the copies drift, dev can silently disagree with production.
RepoWise also identifies the file as churn-heavy and ungoverned.

## What changes

- Add one private V1 predicate for the rendered-or-parent liveness policy.
- Route both actual reconciliation and prospective diagnostics through it.
- Add one behavior-level matrix that compares both paths for unrendered,
  rendered, and provenance-parent components.
- Capture the engine-local decision and its guardrails in this OODA change.

## What does not change

- No public type, function signature, caller, report field, reason string,
  ordering rule, variant/state pruning behavior, NAPI boundary, or V2 source.
- No broad reconciliation-phase extraction.
- No canonical behavior amendment; this implements the existing
  `css-reconciler` parity contract.

## Capability

- ADDED: `arch-extract-v1-reconciler-liveness` — one private V1 liveness policy
  drives actual and prospective component elimination.

## Impact

- Source: `packages/extract/src/reconciler.rs` only.
- Verification: strict OODA validation plus the mapped V1 extraction claim
  (Clippy, Rust units, NAPI canary, integration).
- Risk: 93rd-percentile churn-heavy file, mitigated by one-file scope, exact
  dirty-tree and V2 hashes, a GREEN characterization baseline, and two-phase
  independent review.
