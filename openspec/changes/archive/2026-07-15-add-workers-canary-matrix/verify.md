# Verification Report(s)

## Report: `/root/nightly_openspec_reviewer` · 2026-07-15 portfolio verification

**Change**: `add-workers-canary-matrix`  
**Tree identity**: `feat/random` @ `18b7bcde8c63`  
**Tracked fingerprint before this report**:
`2a03ca3e3d249c6ee724c52c43971d46f91c3c9a15975728b437541b37f035b0`

The fingerprint excludes untracked files and this report edit. A clean landed
SHA is required before archive.

### 1. Structural, registry, and increment state

- `openspec validate --all --json`: **140/140 pass**.
- Registry lint: **0 errors, 0 warnings**.
- Registry completion: **7/7 increments plus completed ops gate 2.1**.
- Showcase, Vite, Vinext, React Router, cutover orchestration, and cold-build
  reproducibility are all represented by completed rows and current evidence.

### 2. Deferral state

- The exact dependency envelope, multi-environment adaptation decision, Vinext
  surface, and remote Worker creation/connection decisions are resolved.
- Preview/custom-domain and additional-framework breadth remain signal-gated
  deferrals. They are not required for the delivered four-Worker matrix.
- No deferred framework support claim is smuggled into current specs.

### 3. Sync and coherence

- All seven delta capabilities are included in the completed six-change
  sequential sync into 25 main capabilities.
- A deterministic second merge produced zero byte differences.
- Independent build targets, structural assertions, credential-free dry-runs,
  cold V2 compilation, and Git-connected reproduction remain coherent across
  design, specs, task graph, and observed deployment behavior.

### 4. Gates and implementation evidence

- Fresh `bunx vp run verify:ci`: **29/29 tasks**, exit 0.
- Evidence includes 222 TS tests, Rust units/hygiene, parity **48/48** in both
  modes plus seam, integration, all four builds/asserts/dry-runs, and packed
  five-tarball verification.
- Cloudflare preview evidence at `18b7bcde8c63`: **four green builds**, a
  representative cold V2 compile, non-empty extracted CSS, and fresh public
  route markers for all four Workers.

### 5. Boundary and review intake

**EVIDENCE-GAP**: referenced new verification/follow-up/spec directories and the
new nightly deployment files include untracked inventory absent from the
tracked fingerprint. The portfolio must land as a complete reproducible unit.

`18b7bcde8c63` is not an ancestor of `main`. The remote proof closes this
change's rollout gate but does not establish mainline archive conformance.
Current verification exposes no open change-local review finding.

### Verdicts

- **Artifact verdict**: **PASS**.
- **Implementation verdict**: **PASS**.
- **Rollout verdict**: **clear**.
- **Archive decision**: **POSTPONE** — land the full inventory on `main` and
  rerun verification on a clean landed SHA.

## Overall Decision

**PASS** — local and remote contracts are proven; archive remains postponed for
reproducible-tree and mainline conformance.
