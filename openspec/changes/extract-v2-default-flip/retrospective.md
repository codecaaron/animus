# Retrospective: extract-v2-default-flip

> Written: 2026-07-15 after independent portfolio verification passed.

## 0. Evidence

- **Increments**: 3/3; registry lint 0/0; no ops gate.
- **Capabilities**: four capabilities, five delta requirements, all synced.
- **Guardrails**: dual-engine packaging, V1 retention, packed V2 loading, and
  V1 fixture override all pass in the current 29-task CI graph.
- **Deferrals**: DEF-1/DEF-3 resolved; loader ownership preserved through
  `extract-quirk-shed#07`.
- **Verdicts**: artifact PASS · implementation PASS · rollout clear · archive
  POSTPONE because the full inventory is not landed on `main`.

| # | Increment | Mode | Outcome |
| --- | --- | --- | --- |
| 01 | ship both binaries | inline + independent review | both engines package and load |
| 02 | flip defaults | inline + independent review | V2 default, V1 override retained |
| 03 | retire scaffolding | inline/self review | provably dead compatibility scaffolding removed |

## 1. Wins

- The default flip and distribution seam shipped as one reversible contract.
- Packed verification now exercises both engine exports rather than trusting a
  workspace install.
- The final audit narrowed the missing-binary promise to V2, matching the real
  loader instead of broadening implementation for symmetry.

## 2. Misses

- 🟡 The original fail-loud wording overclaimed V1 behavior; registry lint also
  exposed stale packet-path and requirement-header references.
- 🔴 Archive identity is still unprovable until tracked and untracked files land
  together on `main`.

## 3. Plan deviations

| Row | Deviation | Evidence | Disposition |
| --- | --- | --- | --- |
| 01 | Missing-binary requirement narrowed to V2 | `2026-07-15 14:50 EDT · registry-correction` | accepted; matches implementation |
| 03 | Only provably dead scaffolding retired | increment 03 reorientation | retained live parity/escape surfaces |

## 4. Workflow compliance

Brainstorming, per-increment planning, TDD/verification, and independent review
were used. No required workflow was deliberately skipped.

## 5. Surprises

- The generated V1 loader's generic error was contextualized as a different
  ownership boundary, not a reason to enlarge the flip.
- The packed consumer confirmed supported module modes rather than a false
  every-package CJS promise.

## 6. Promote candidates

- [x] **Package-form verification is part of engine release truth** → synced to
  `engine-release-packaging` and `dual-engine-build`.
- [x] **Default flips retain an explicit working escape hatch** → synced to the
  Vite and Next engine-selection requirements.
