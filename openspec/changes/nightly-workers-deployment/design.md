## Context

Four independently named Cloudflare Workers currently use Git-connected Workers Builds. A single commit therefore repeats the same cold Rust/NAPI compilation four times before performing four short deployments. The repository already has V2-only Worker build tasks, structural assertions, focused Wrangler dry-runs, and dual-engine release CI. The replacement must reuse those contracts without making nightly deployment part of npm release eligibility.

## Goals / Non-Goals

**Goals:**

- Build shared V2 and TypeScript prerequisites once per nightly run.
- Validate all four Worker outputs before changing remote state.
- Deploy four independent Workers from one `main` SHA with explicit failure reporting.
- Preserve the existing Git-connected path until the replacement is proven.

**Non-Goals:**

- Adding V1 to deployment canaries.
- Changing the six-job npm release gate.
- Making the four remote deploys transactionally atomic.
- Adding production health endpoints or URL polling to repository unit tests.
- Solving cross-run artifact caching before measurements justify it.

## Decisions

### D1: Schedule and dispatch through GitHub Actions

- **Choice**: Add one workflow with nightly scheduling and manual dispatch, guarded to `refs/heads/main`.
- **Rationale**: One runner can reuse shared build outputs and deploy all four Workers from one commit.
- **Alternatives considered**: Cloudflare Deploy Hooks retain four independent builds; a synthetic nightly branch retains the cost and adds branch churn.

### D2: Keep deployment validation V2-only

- **Choice**: Build only the V2 NAPI binary in this workflow.
- **Rationale**: Every Worker fixture selects V2, while release CI already proves both package engines.
- **Alternatives considered**: Building V1 nightly duplicates release evidence without exercising a deployed path.

### D3: Separate validation from mutation

- **Choice**: Build, assert, and dry-run all four targets before the first deploy command.
- **Rationale**: A deterministic pre-deploy gate avoids knowingly starting a partial rollout with invalid artifacts.
- **Alternatives considered**: Per-target build-and-deploy shortens time to the first deployment but creates avoidable mixed-SHA state.

### D4: Attempt every deployment and aggregate failures

- **Choice**: After validation, attempt all four deploy commands and exit non-zero if any fail.
- **Rationale**: Independent canaries should not suppress one another, while partial failure must remain visible.
- **Alternatives considered**: Fail-fast deployment hides the state of later targets; matrix fan-out adds artifact-transfer complexity before it is needed.

### D5: Keep Worker deployments outside the release gate

- **Choice**: The nightly is an operational canary and SHALL NOT become a prerequisite of npm publishing.
- **Rationale**: Release truth is already captured by lint, Rust hygiene, core verify, Next, Vite, and packed-artifact jobs; remote deployment availability is a different authority boundary.
- **Alternatives considered**: Blocking releases on four remote services couples npm availability to Cloudflare control-plane health.

### D6: Cut over only after a successful main run

- **Choice**: Leave Cloudflare Git Builds enabled until scoped secrets exist, a manual run succeeds from merged `main`, and all four production URLs are smoked.
- **Rationale**: This prevents a deployment gap and gives rollback a known-good path.
- **Alternatives considered**: Disabling Git Builds when the workflow file lands creates an unproven single point of failure.

## North Star

**Adversarial cadence K**: 2

- **NS1**: One source commit and one shared build feed four independently deployable Workers.
- **NS2**: Repository validation completes before remote mutation begins.
- **NS3**: Deployment truth and release truth remain separate, explicit contracts.
- **NS4**: The single-job shape remains intentionally simple — provisional; revisit when `external:nightly-runtime-budget-breach` or repeated partial-deploy recovery supplies contrary evidence.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | GitHub Actions credential installation | deferred | `change:nightly-workers-deployment#2.1` | `external:github-actions-secrets-provisioned` | 3 reorientations \| 2026-08-15 |
| DEF-2 | Disable Cloudflare Git Builds | deferred | `change:nightly-workers-deployment#2.1` | `external:nightly-workers-main-success` | 3 reorientations \| 2026-08-15 |
| DEF-3 | Replace the single job with artifact fan-out or parallel deploy jobs | deferred | `external:nightly-deployment-optimization-review` | `external:nightly-runtime-budget-breach` | 6 reorientations \| 2026-10-15 |
| DEF-4 | Add V1 to deployment canaries | deferred | `external:v1-deployment-coverage-review` | `external:v1-production-deployment-demand` | 6 reorientations \| 2026-10-15 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | Tracked workflow and scripts SHALL NOT contain literal Cloudflare credentials; blind spot: encrypted repository-secret values are outside the checkout | inc:01 | STOP | armed(inc 01) |
| G2 | The nightly deployment path SHALL NOT build V1 | inc:01 | STOP | armed(inc 01) |
| G3 | No deploy command SHALL precede completion of all build, assertion, and dry-run commands | inc:01 | STOP | armed(inc 01) |
| G4 | The npm release job SHALL NOT gain Worker deployment prerequisites | all | STOP | active (calibrated 2026-07-15: existing contract test passes) |
| G5 | Cloudflare Git Builds SHALL NOT be disabled before a recorded successful `main` run and four URL smokes | change-end | STOP | active until gate 2.1 closes |

Checks — verbatim commands:

**G1** — expected: empty output after increment 01

```bash
rg -n 'CLOUDFLARE_(API_TOKEN|ACCOUNT_ID):[[:space:]]+[^$]' .github/workflows scripts
```

**G2** — expected: empty output after increment 01

```bash
rg -n 'build:extract-v1' .github/workflows/deploy-workers-nightly.yml scripts/deploy/workers-nightly.sh
```

**G3** — expected: the focused structural test exits 0 after increment 01

```bash
bunx vp test run scripts/verify/workers-config.test.ts
```

**G4** — expected: the focused structural test exits 0

```bash
bunx vp test run scripts/verify/workers-config.test.ts
```

**G5** — expected before cutover: one open gate task; expected after cutover: zero open gate tasks plus a run URL in the journal

```bash
rg -n 'OPS-3.*Disable Cloudflare Git Builds' openspec/changes/nightly-workers-deployment/ops-runbook.md
```

## Risks / Trade-offs

- [Risk] Four deploys cannot be atomic -> Mitigation: validate all artifacts first, deploy one SHA, attempt every target, and make same-SHA manual retry the recovery path.
- [Risk] Scheduled failures become ignored noise -> Mitigation: one owned workflow, concurrency control, and no additional canary schedules without a named consumer.
- [Risk] Credentials are over-scoped -> Mitigation: use an account-scoped token limited to Worker script deployment and store it only in GitHub Actions secrets.
- [Trade-off] The workflow does not prove V1 deployment -> acceptable because no Worker selects V1 and release CI owns dual-engine proof.
- [Trade-off] The first implementation runs sequentially -> acceptable until measurements trigger DEF-3.

## Migration Plan

1. Land the structural tests, deployment script, and manual/nightly workflow while Cloudflare Git Builds remain enabled.
2. Install `CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN` in GitHub Actions.
3. Run the workflow manually from merged `main` and record the run URL and SHA.
4. Smoke all four production Worker URLs and confirm the deployed commit is consistent.
5. Disable Git Builds for the four Cloudflare Workers through the authenticated dashboard.
6. Observe the next scheduled run. If it fails, re-enable Git Builds and retry the same SHA after correction.
