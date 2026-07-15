# Retrospective: add-workers-canary-matrix

> Written: 2026-07-15 after independent local and remote verification passed.

## 0. Evidence

- **Registry**: 7/7 increments plus closed gate 2.1; registry lint 0/0.
- **Capabilities**: seven Worker/workspace/fixture capabilities synced
  idempotently to main specs.
- **Local verification**: `verify:ci` 29/29, including four build/assert/dry-run
  targets and Worker structural contracts.
- **Remote verification**: four green Cloudflare preview builds at
  `18b7bcde8c63`, representative cold V2 compilation, non-empty CSS, and fresh
  public route markers.
- **Verdicts**: artifact PASS · implementation PASS · rollout clear · archive
  POSTPONE because the verified inventory is not on `main`.

## 1. Wins

- Showcase, Vite, Vinext, and React Router v8 now have independent, app-owned
  Worker identities and credential-free dry-run contracts.
- The first remote cold-build failure created a reproducibility increment
  instead of becoming dashboard folklore.
- Fixture route/style markers replaced production URL health tests, keeping
  repository tests structural and deterministic.

## 2. Misses

- 🟡 Git-connected builds compile the same Rust/V2 prerequisites four times;
  that operational cost motivated the separate nightly deployment change.
- 🟡 Early runbook text retained obsolete `/api/health` expectations after the
  production health-test decision changed; closure now uses fixture markers.
- 🔴 Archive remains blocked until all tracked/untracked portfolio files land
  on `main` and verification is rerun there.

## 3. Plan deviations

| Row | Deviation | Journal trace | Why |
| --- | --- | --- | --- |
| 07 | Materialized after the initial remote build | first Git-triggered failure / 14:21 reorientation | Cloudflare lacked libclang and exposed clean-checkout assumptions |
| 2.1 | Closed on preview build + route/CSS evidence | `2026-07-15 14:48 EDT` | proves Git-connected executor without overclaiming nightly/main proof |

## 4. Workflow compliance

Brainstorming, increment planning, TDD, delegated implementation/review, remote
evidence capture, and final verification were used. No required workflow was
deliberately skipped.

## 5. Surprises

- Cloudflare's cold environment required explicit Node/Bun pins and published
  QuickJS bindings rather than local NAPI assumptions.
- Connecting a repository did not itself enqueue the first build; a later Git
  event supplied the resolving signal.

## 6. Promote candidates

- [x] **Every Worker target owns build, assert, and dry-run contracts** → synced
  to the Worker matrix and verification-tier specs.
- [x] **Remote health polling is not a production unit-test contract** → route
  and extracted-style markers now carry the canary proof.
- [ ] **Disable Git Builds only after the nightly main path is proven** → owned
  by `nightly-workers-deployment` OPS-1–OPS-4.
