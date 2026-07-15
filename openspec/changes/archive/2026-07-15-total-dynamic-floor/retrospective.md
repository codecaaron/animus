# Retrospective: total-dynamic-floor

> Written: 2026-07-15 after independent portfolio verification passed.

## 0. Evidence

- **Registry**: 4/4 rows; rows 01–03 implemented, row 04 retired to a triggered
  follow-up; registry lint 0/0.
- **Capability**: `dynamic-prop-fallback` synced idempotently to main specs.
- **Verification**: current `verify:ci` passes 29/29, including 222 TS tests,
  Rust/parity/integration, all consumers/Workers, and packed artifacts.
- **Deferrals**: DEF-1/DEF-3 resolved; DEF-2 preserved as TF-1 with explicit
  dogfood owner/trigger. TF-2/TF-3 preserve package-first and mode seams.
- **Verdicts**: artifact PASS · implementation PASS · rollout clear · archive
  POSTPONE for mainline/reproducible-tree conformance.

## 1. Wins

- Conservative reachability widening closes the silent-drop soundness hole.
- Runtime diagnostics remain development-only and perform no witness-style
  serialization work in production.
- Floor and reconciliation now share one component-identity policy.

## 2. Misses

- 🟡 First-party CSS cost is intrinsically high (+84.61% to +447.15%); narrowing
  helps future dead-component projects but saved zero bytes in current fixtures.
- 📌 Value-independent diagnostic dedupe remains unchosen because no dogfood
  evidence establishes that higher-cardinality warnings are actionable.
- 🔴 Archive waits for the complete inventory to land on `main`.

## 3. Plan deviations

| Row | Deviation | Journal trace | Why |
| --- | --- | --- | --- |
| 03 | Narrowing delivered zero current savings | `2026-07-13 21:46 · surprise` | retained components expose the full prop universe |
| 03 | Uncertainty policy widened after review | `2026-07-13 22:31 · review-correction` | recognized-binding-only logic was unsound |
| 04 | Retired to follow-up | `2026-07-15 14:44 EDT · reorientation` | DEF-2 dogfood signal never fired |

## 4. Workflow compliance

Brainstorming, incremental plans, TDD, delegated review, and final verification
were used. No required workflow was deliberately skipped.

## 5. Surprises

- The byte-cost surprise is confirmed and explicitly accepted as the price of
  totality for the current retained component universe.
- Lowercase dynamic `createElement(component)` required component-like widening;
  string-literal native calls remain the discriminating control.

## 6. Promote candidates

- [x] **Floor and reconciliation share one canonical identity set and widen on
  uncertainty** → synced to `dynamic-prop-fallback`.
- [ ] **Revisit diagnostic granularity only with real distinct-value dogfood**
  → carried as TF-1, review 2026-08-15.
