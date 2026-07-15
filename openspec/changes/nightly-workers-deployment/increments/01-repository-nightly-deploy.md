# Increment 01: Repository Nightly Deploy

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4, D5
- **Authors**: — (the envelope already contains all scheduled-worker-deployment requirements)
- **Depends on**: none
- **Inputs from**: none
- **Footprint**: `.github/workflows/deploy-workers-nightly.yml`, `scripts/deploy/workers-nightly.sh`, `scripts/verify/workers-config.test.ts`
- **Pushes to a later increment**: credential provisioning, successful merged-main run, production smokes, and Cloudflare Git-build disablement remain in gate 2.1 / `ops-runbook.md`

> Resolving signal: envelope-licensed decided-now implementation; journal seed `2026-07-15 14:37` records row 01.

## Context Capsule

- **Objective**: Add one GitHub Actions workflow and one injectable shell orchestrator. The orchestrator must reject non-main refs and missing credentials before work, build V2 and shared TS once, build/assert/dry-run all four applications before any deploy, then attempt all four same-SHA deploys while aggregating failures. Cloudflare Git Builds remain enabled; no dashboard mutation belongs to this increment.
- **Repository commands**:
  - Shared prerequisites: `bunx vp run build:extract-v2`, `bunx vp run build:ts`
  - Per target: `bunx vp run verify:build:<target>`, `verify:assert:<target>`, `verify:dry-run:<target>` for `showcase`, `vite`, `vinext`, `react-router`
  - Deploy: root scripts `bun run deploy:<target>`
  - Workflow toolchain patterns: `.github/workflows/ci.yaml` uses `actions/setup-node@v4` with `.tool-versions` and `oven-sh/setup-bun@v2` with `.tool-versions`
- **In-scope guardrails**:
  - G1: tracked workflow and scripts SHALL NOT contain literal Cloudflare credentials — check: `rg -n 'CLOUDFLARE_(API_TOKEN|ACCOUNT_ID):[[:space:]]+[^$]' .github/workflows scripts` — STOP
  - G2: nightly path SHALL NOT build V1 — check: `rg -n 'build:extract-v1' .github/workflows/deploy-workers-nightly.yml scripts/deploy/workers-nightly.sh` — STOP
  - G3: no deploy command precedes all validation commands — check: `bunx vp test run scripts/verify/workers-config.test.ts` — STOP
  - G4: npm release prerequisites remain unchanged — check: `bunx vp test run scripts/verify/workers-config.test.ts` — STOP
- **Existing spec context**: `openspec/changes/nightly-workers-deployment/specs/scheduled-worker-deployment/spec.md`; no spec writing is delegated.
- **Resolved decisions**: D1 GitHub nightly/manual main-only workflow; D2 V2-only; D3 validate all before mutation; D4 aggregate deployment failures; D5 release gate unchanged.
- **Upstream inputs**: none.
- **North Star**: NS1 one shared build/four targets; NS2 validation before mutation; NS3 deploy truth separate from release truth; NS4 simple single job.
- **Prohibitions**: no version-control commands; no writes outside the footprint or this packet; do not edit OpenSpec shared artifacts; do not configure GitHub secrets or mutate Cloudflare; do not add production URL tests.

## Plan

## Task 01.1: Specify orchestration behavior first

- [x] **Step 1:** Extend `scripts/verify/workers-config.test.ts` with failing tests that require `.github/workflows/deploy-workers-nightly.yml` and `scripts/deploy/workers-nightly.sh`, assert manual + nightly triggers, `main` guarding, pinned setup actions, least-privilege workflow permissions, concurrency, secret expressions, and one script invocation.
- [x] **Step 2:** In the same test file, create a temporary executable command double using the existing `mkdtempSync`, `writeFileSync`, `spawnSync`, and `rmSync` helpers. Execute the missing script with `BUNX_BIN` and `BUN_BIN` pointed at the double and assert the exact command log: two shared builds; four builds; four assertions; four dry-runs; then four deploys.
- [x] **Step 3:** Add failing cases proving non-main and missing-secret preflights invoke no command, plus one failed deploy still attempts every deploy and returns non-zero.
- [x] **Step 4:** Run `bunx vp test run scripts/verify/workers-config.test.ts`; expected RED is missing workflow/script assertions rather than a test harness error.

## Task 01.2: Implement the minimal deployment orchestrator

- [x] **Step 1:** Create `scripts/deploy/workers-nightly.sh` with `set -euo pipefail`, injectable `BUNX_BIN`/`BUN_BIN`, `GITHUB_REF == refs/heads/main`, non-empty `GITHUB_SHA`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN` preflights before any command.
- [x] **Step 2:** Invoke `build:extract-v2` and `build:ts` exactly once, then run all `verify:build:*`, all `verify:assert:*`, and all `verify:dry-run:*` commands in separate complete phases.
- [x] **Step 3:** After validation, loop over the four targets, log `source-sha=$GITHUB_SHA` with the target, run `bun run deploy:<target>`, accumulate failed target names, and exit non-zero after attempting all four when the failure list is non-empty.
- [x] **Step 4:** Run the focused test; expected GREEN is all structural and injected-command behavior passing without a real build or deploy.

## Task 01.3: Add the scheduled/manual workflow

- [x] **Step 1:** Create `.github/workflows/deploy-workers-nightly.yml` with `workflow_dispatch`, cron `17 6 * * *`, `permissions: contents: read`, concurrency group `deploy-workers-nightly`, `cancel-in-progress: false`, and one Ubuntu job guarded to `refs/heads/main`.
- [x] **Step 2:** Check out source, set up Node and Bun from `.tool-versions`, run `bun install --frozen-lockfile`, then invoke `bash scripts/deploy/workers-nightly.sh` with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` sourced from encrypted Actions secrets.
- [x] **Step 3:** Re-run `bunx vp test run scripts/verify/workers-config.test.ts`; expected GREEN.
- [x] **Step 4:** Run `openspec validate nightly-workers-deployment --strict`; expected valid.

## Guardrail gate

- [x] G1: `rg -n 'CLOUDFLARE_(API_TOKEN|ACCOUNT_ID):[[:space:]]+[^$]' .github/workflows scripts` — result: PASS, empty output (expected `rg` exit 1)
- [x] G2: `rg -n 'build:extract-v1' .github/workflows/deploy-workers-nightly.yml scripts/deploy/workers-nightly.sh` — result: PASS, empty output (expected `rg` exit 1)
- [x] G3: `bunx vp test run scripts/verify/workers-config.test.ts` — result: PASS, 38/38
- [x] G4: `bunx vp test run scripts/verify/workers-config.test.ts` — result: PASS, release-needs contract unchanged within 38/38

## Output contract

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-only; no requirement draft is owed
- [x] Guardrail results are recorded with output excerpts
- [x] Proposed journal entries are returned for orchestrator review
- [x] Surfaced variables: repository implementation requires `GITHUB_REF`, `GITHUB_SHA`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN`; credential provisioning and main-run proof remain gate 2.1 / OPS-1–OPS-4

## Spec authorship checklist

- [x] Confirmed the envelope requirements cover the implemented behavior
- [x] No deferred Decision Ledger row is falsely resolved by repository-only work
- [x] Accepted journal entries appended by the orchestrator
- [x] Reorientation entry written with full adversarial pass
- [x] Registry row ticked with the reorientation timestamp
