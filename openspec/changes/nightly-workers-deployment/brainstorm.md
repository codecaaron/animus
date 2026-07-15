# Nightly Workers Deployment — Exploration Record

Evidence captured from the approved 2026-07-15 design review and live Cloudflare audit in this task. All four Git-connected Workers independently rebuilt the same Rust/NAPI V2 dependency chain for commit `18b7bcd`; the Vite build alone spent about 2m44s in its build phase, while deployment took 18s. All four preview versions and their emitted CSS were subsequently smoke-tested successfully.

## Decision chain

1. Cloudflare Workers Builds tied to Git branches run once per Worker and therefore repeat the expensive Rust compilation four times for the same commit.
2. Cloudflare Deploy Hooks would change the trigger but not the repeated-build topology, so they do not address the cost.
3. A synthetic nightly branch would retain the repeated builds and add branch churn.
4. One scheduled or manually dispatched GitHub job can build V2 and shared TypeScript packages once, validate every application, and deploy four independently named Workers from one SHA.
5. The existing release pipeline already proves both V1 and V2 package artifacts. The deployment canary therefore needs V2 only; rebuilding V1 nightly would add cost without strengthening the deployment claim.
6. Cloudflare Git Builds must remain enabled until the replacement succeeds from `main`, preventing a deployment gap.

## Known now

- The workflow runs nightly and by manual dispatch from `main` only.
- It uses the repository-pinned Node, Bun, and Rust versions.
- V2 NAPI and shared TypeScript packages build once per workflow run.
- All four applications build, assert, and pass credential-free Wrangler dry-runs before any deployment begins.
- The four deployments target `animus`, `animus-vite-canary`, `animus-vinext-canary`, and `animus-react-router-canary` at one Git SHA.
- A failure to deploy one Worker does not suppress attempts for the remaining Workers; the job reports an aggregate failure afterward.
- Credentials are supplied only through scoped GitHub Actions secrets.
- Worker deployment remains non-blocking for npm release eligibility.

## Deferred with resolving signals

- **Credential provisioning:** deferred until `CLOUDFLARE_ACCOUNT_ID` and a Workers-script-edit API token are installed as GitHub Actions secrets. Signal: a manual workflow run passes its credential preflight.
- **Production cutover:** deferred until the workflow succeeds from the merged `main` commit and all four production URLs identify the same SHA. Signal: a successful manual run plus four HTTP smoke receipts.
- **Disable Cloudflare Git Builds:** deferred until the production cutover signal exists. Signal: the successful replacement run is recorded in the change journal.
- **Artifact fan-out or parallel deploy jobs:** deferred until nightly duration or reliability measurements show the single-job implementation is inadequate. Signal: three measured runs exceed the agreed runtime budget or demonstrate recurring partial-deploy recovery pain.
- **V1 nightly deployment coverage:** deferred indefinitely while release CI continues to prove V1 packaging and parity. Signal: a supported production deployment path explicitly selects V1.

## Candidate north stars

- One source commit, one shared build, four independently deployable Workers.
- Validation finishes before mutation begins.
- The nightly proves deployment truth; release CI proves package and dual-engine truth.
- Operational ownership stays explicit: a failed nightly is actionable, not an ignored red wall.
- Revisit the single-job shape only when measured nightly behavior supplies the signal above.

## Candidate guardrails

- The change SHALL NOT disable Cloudflare Git Builds before a successful replacement run from `main`. Check: the cutover task remains open until a recorded run URL and smoke receipt exist.
- The change SHALL NOT compile V1 in the nightly deployment path. Check: a structural test rejects `build:extract-v1` in the workflow and deployment script.
- The change SHALL NOT deploy before all four build/assert/dry-run phases succeed. Check: a structural test proves every validation command precedes the first deploy command.
- The change SHALL NOT embed account IDs or API tokens in tracked files. Check: workflow tests require secret expressions and repository secret scanning remains green.
- The change SHALL NOT broaden the npm release gate. Check: CI contract tests continue to assert the exact six release prerequisites.
- The change SHALL NOT silently succeed after a partial deployment. Check: the deployment script accumulates failures and exits non-zero after attempting all four targets.
