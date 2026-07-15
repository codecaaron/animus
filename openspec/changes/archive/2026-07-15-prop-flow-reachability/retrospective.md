# Retrospective: prop-flow-reachability

> Written: 2026-07-15 after independent portfolio verification passed.

## 0. Evidence

- **Registry**: 8/8 rows; three implemented, five explicitly retired; registry
  lint 0/0.
- **Capabilities**: residue facts, witness recording, shared prop maps, and JSX
  scanning synced idempotently to main specs.
- **Verification**: current `verify:ci` passes 29/29; parity remains 48/48 in
  both modes plus seam coverage.
- **Deferrals**: DEF-5 resolved; DEF-1–4 preserved as PF-1–PF-4 with measurement
  owners, triggers, and review dates.
- **Verdicts**: artifact PASS · implementation PASS · rollout clear · archive
  POSTPONE for mainline/reproducible-tree conformance.

## 1. Wins

- Measurement preceded interprocedural machinery; the first corpus showed only
  one dynamic residue site and did not license speculative tiers.
- Raw public facts stayed syntax-classified while the engine gained a private
  enriched analysis view.
- The dev witness buffer is bounded, production-excluded, and avoids eager
  production serialization.

## 2. Misses

- 🟡 The first enrichment version leaked analysis values into the raw fact
  contract and repeated Pass-A traversal; review caught both.
- 📌 Wrapper-depth, typed-resolvability, annotation-resolvability, and stable
  witness signals remain unmeasured by design.
- 🔴 Archive waits for all referenced new files to land on `main`.

## 3. Plan deviations

| Rows | Deviation | Journal trace | Why |
| --- | --- | --- | --- |
| 03 | Raw/enriched views separated | `2026-07-13 22:31 · review-correction` | preserve serialized contract and reuse Pass-A maps |
| 04–07 | Retired to follow-ups | `2026-07-15 14:44 EDT · reorientation` | direct resolving probes did not fire |
| 08 | Retired without machinery | inc 01 reorientation | corpus had zero broader arm-join forms |

## 4. Workflow compliance

Brainstorming, per-increment planning, TDD, delegated review, and final
verification were used. No required workflow was deliberately skipped.

## 5. Surprises

- Lowercase dynamic `createElement` required exact binding identity handling.
- Witness value serialization initially happened before its production gate;
  the focused regression now protects the corrected boundary.

## 6. Promote candidates

- [x] **Keep public raw facts syntax-classified; enrich only private analysis**
  → reflected in synced scanner/residue requirements.
- [ ] **Add deeper machinery only after a direct material-tail measurement** →
  retained as PF-1–PF-4.
