# Ops Runbook: nightly-workers-deployment

| ID | External action | Owner / system | Ordering constraint | Rollback / repair | Close condition | Status |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-1 | Install `CLOUDFLARE_ACCOUNT_ID` and a Workers-script-edit `CLOUDFLARE_API_TOKEN` as GitHub Actions secrets | `codecaaron/animus` repository administrator / GitHub Actions | After increment 01 lands; before the first workflow run | Revoke the token and remove both repository secrets | `external:github-actions-secrets-provisioned`: workflow credential preflight passes without exposing either value | open |
| OPS-2 | Manually dispatch `deploy-workers-nightly.yml` from merged `main` and record its run URL and source SHA | GitHub Actions / repository maintainer | After OPS-1; Cloudflare Git Builds remain enabled | Rerun the same SHA after correcting the failing target; existing Git Builds remain the fallback | `external:nightly-workers-main-success`: all validation and four deployments pass for one `main` SHA | open |
| OPS-3 | Disable Git Builds for `animus`, `animus-vite-canary`, `animus-vinext-canary`, and `animus-react-router-canary` | Cloudflare account `a9d267094b7ea8cff320f2bfcd2d28a6` / Workers Builds | Only after OPS-2 and four successful production smokes | Re-enable each service's repository connection and prior branch settings | All four services no longer build on Git pushes and retain the OPS-2 deployed versions | open |
| OPS-4 | Observe the next scheduled run and smoke all production URLs | GitHub Actions + Cloudflare Workers | After OPS-3 | Re-enable Git Builds, then repair or manually rerun the nightly path | Scheduled run succeeds and the four production route markers plus non-empty CSS assets respond | open |

Verification — runnable after the workflow exists on `main`:

**OPS-1** — expected: the latest manual run reaches the build phase; secret values never appear.

```bash
gh run list --workflow deploy-workers-nightly.yml --limit 1
```

**OPS-2** — expected: conclusion `success`, event `workflow_dispatch`, branch `main`.

```bash
gh run list --workflow deploy-workers-nightly.yml --event workflow_dispatch --branch main --limit 1 --json conclusion,event,headBranch,headSha,url
```

**OPS-3** — dashboard verification required. For each Worker, Builds settings must show no connected Git repository. Do not perform this step until OPS-2 is closed.

**OPS-4** — expected: the scheduled run succeeds and every command exits 0.

```bash
gh run list --workflow deploy-workers-nightly.yml --event schedule --branch main --limit 1 --json conclusion,event,headBranch,headSha,url
curl -fsS https://animus.airrobb.workers.dev/ | rg -F '<title>Animus</title>'
curl -fsS https://animus-vite-canary.airrobb.workers.dev/ | rg -F '<title>Animus Vite Test App</title>'
curl -fsS https://animus-vinext-canary.airrobb.workers.dev/ | rg -F 'Vinext RSC canary'
curl -fsS https://animus-react-router-canary.airrobb.workers.dev/ | rg -F 'React Router v8 SSR canary'
```
