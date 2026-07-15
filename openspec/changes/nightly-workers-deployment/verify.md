# Verification Report(s)

## Report: `/root/nightly_openspec_reviewer` · 2026-07-15 portfolio verification

**Change**: `nightly-workers-deployment`  
**Verifier**: independent implementation reviewer; not the implementer  
**Tree identity**: `feat/random` @ `18b7bcde8c63`  
**Tracked fingerprint before this report**:
`2a03ca3e3d249c6ee724c52c43971d46f91c3c9a15975728b437541b37f035b0`

The fingerprint excludes untracked files and this report edit. A clean landed
SHA is required for archive conformance; fingerprint equality alone is not
sufficient.

### 1. Structural and registry state

- `openspec validate --all --json`: **140/140 pass**.
- Registry lint: **0 errors, 0 warnings**.
- Registry state: increment 01 is complete; cross-cutting gate 2.1 remains open.
- The open row is an explicit `gate:ops`, not missing repository implementation.

**Artifact result**: the artifacts accurately separate repository delivery from
external rollout. The open gate is correctly represented and does not get
laundered into a completed task.

### 2. Increment and deferral completeness

- Increment 01 implements D1-D5: main-only schedule/manual dispatch, V2-only
  shared build, validation before mutation, aggregate deploy attempts, and
  release/deployment authority separation.
- DEF-1 and DEF-2 remain owned by gate 2.1 and require credential provisioning
  plus a successful merged-main deployment before Git Builds are disabled.
- DEF-3 and DEF-4 remain signal-gated optimization/coverage follow-ups; neither
  is silently resolved by the current implementation.

### 3. Sync and coherence

- `scheduled-worker-deployment` is intentionally **not synced** to main specs.
- Sync remains blocked until the merged-main proof and OPS-1 through OPS-4 are
  complete.
- Proposal, design, delta spec, increment, runbook, and implementation agree on
  the single-job V2-only boundary and on retaining Git Builds through proof.
- The other six completed portfolio changes have already been sequentially
  synced into 25 main capabilities; a deterministic second merge produced zero
  byte differences.

### 4. Gates and implementation evidence

- Fresh `bunx vp run verify:ci`: **29/29 tasks**, exit 0.
- The run includes 222 TS tests, Rust units/hygiene, canary, parity 48/48 in both
  modes plus seam, integration, all four Worker builds/asserts/dry-runs, and the
  five-tarball packed lane.
- Nightly focused verification: **38/38 tests pass**.
- `bash -n scripts/deploy/workers-nightly.sh`: pass.
- Literal-credential and V1-build guards: empty.
- Validation failures are discriminated to cause zero deploys; multiple deploy
  failures attempt every target and produce an aggregate target summary.

**Implementation result**: repository implementation is complete and viable.

### 5. Boundary and archive conformance

**EVIDENCE-GAP**: the nightly workflow/script and referenced new verification,
follow-up, and spec directories include untracked files. They are absent from
the tracked fingerprint and must land as one reproducible inventory.

`18b7bcde8c63` is not an ancestor of `main`. Do not claim archive readiness from
the feature-branch run. After all files land, verification must be rerun on a
clean landed SHA before sync/archive.

### 6. Review-finding intake

The independent implementation review found five issues: broad secret scope,
non-frozen install, missing aggregate failure summary, missing validation-failure
discrimination, and incomplete workflow structural assertions. All five were
fixed and the bounded re-review returned **APPROVED** with no remaining finding.

### Verdicts

- **Artifact verdict**: **PASS WITH WARNINGS** — accurate artifacts; OPS gate open.
- **Implementation verdict**: **PASS**.
- **Rollout verdict**: **OPS-GATED** — OPS-1 through OPS-4 remain open.
- **Archive decision**: **POSTPONE** — complete ops proof, sync the delta, land
  the full tracked/untracked inventory on `main`, and rerun on a clean SHA.

## Overall Decision

**PASS WITH WARNINGS** — repository implementation is approved; rollout, sync,
and archive remain intentionally blocked by the explicit ops gate and tree
conformance evidence gap.
