# Ops Runbook: add-workers-canary-matrix

| ID | External action | Owner / system | Ordering constraint | Rollback / repair | Close condition | Status |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-1 | Update Worker `animus` to repository-root Workers Builds commands and deploy the checked-in showcase config | Cloudflare account `a9d267094b7ea8cff320f2bfcd2d28a6` / Workers Builds | After increment 06 local gates pass; Netlify is not an operational fallback | Restore the prior Build settings and promote the previous healthy Worker version | `external:animus-worker-matrix-live` observed: Git-connected build succeeds and root plus deep route respond with the showcase document | closed 2026-07-15 — preview build passed; root/deep smokes and non-empty CSS confirmed |
| OPS-2 | Create Worker `animus-vite-canary`, connect `codecaaron/animus`, and enable non-production builds | Cloudflare account `a9d267094b7ea8cff320f2bfcd2d28a6` / Workers Builds | After increment 06 local gates pass | Delete the new canary Worker or promote its previous healthy version | `external:vite-worker-canary-live` observed: Git build succeeds, SPA fallback responds, and strict-extraction CSS is non-empty | closed 2026-07-15 — preview build passed; representative cold V2 log and SPA/CSS smokes confirmed |
| OPS-3 | Create Worker `animus-vinext-canary`, connect `codecaaron/animus`, and enable non-production builds | Cloudflare account `a9d267094b7ea8cff320f2bfcd2d28a6` / Workers Builds | After increment 06 local gates pass | Delete the new canary Worker or promote its previous healthy version | `external:vinext-worker-canary-live` observed: Git build succeeds and App, client, and legacy route markers respond | closed 2026-07-15 — preview build and all route smokes passed with non-empty CSS |
| OPS-4 | Create Worker `animus-react-router-canary`, connect `codecaaron/animus`, and enable non-production builds | Cloudflare account `a9d267094b7ea8cff320f2bfcd2d28a6` / Workers Builds | After increment 06 local gates pass | Delete the new canary Worker or promote its previous healthy version | `external:react-router-worker-canary-live` observed: Git build succeeds and SSR plus client route markers respond | closed 2026-07-15 — preview build and both route smokes passed with non-empty CSS |

Verification — one fenced block per row, runnable verbatim:

## Workers Builds settings

Before changing remote state, run the account preflight. Expected: output
contains account ID `a9d267094b7ea8cff320f2bfcd2d28a6`.

```bash
bunx wrangler whoami | rg -F 'a9d267094b7ea8cff320f2bfcd2d28a6'
```

Every service uses root directory `/`, production branch `main`, and enabled
non-production builds. Configure the remaining fields exactly as follows:

| Worker | Build command | Deploy command | Version command |
| --- | --- | --- | --- |
| `animus` | `bun install && bunx vp run build:showcase` | `bun run --filter '@animus-ui/showcase' cf:deploy` | `bun run --filter '@animus-ui/showcase' cf:upload` |
| `animus-vite-canary` | `bun install && bunx vp run build:vite` | `bun run --filter '@animus-ui/vite-app' cf:deploy` | `bun run --filter '@animus-ui/vite-app' cf:upload` |
| `animus-vinext-canary` | `bun install && bunx vp run build:vinext` | `bun run --filter '@animus-ui/vinext-app' cf:deploy` | `bun run --filter '@animus-ui/vinext-app' cf:upload` |
| `animus-react-router-canary` | `bun install && bunx vp run build:react-router` | `bun run --filter '@animus-ui/react-router-app' cf:deploy` | `bun run --filter '@animus-ui/react-router-app' cf:upload` |

### Authentication observation — 2026-07-14 03:14 EDT (superseded)

The local ops preflight returned `You are not authenticated`, and the in-app
Cloudflare dashboard session redirected to `/login`. No remote mutation was
attempted. Public read-only smokes show the previously healthy `animus` version
still serves `/` and `/docs/start` with the Animus title/layer markers, while the
three new canary hostnames return HTTP 404. OPS-1–OPS-4 remain open until a user
authenticates Wrangler or the dashboard for account
`a9d267094b7ea8cff320f2bfcd2d28a6`.

### Live deployment observation — 2026-07-14 11:50 EDT

Wrangler OAuth authenticated the intended account and deployed every checked-in
target at 100% traffic:

| Worker | Version | Production smoke |
| --- | --- | --- |
| `animus` | `91179a2d-fcee-4b68-8321-d777d78cc0a5` | `/` and `/docs/start` serve the Animus SPA document |
| `animus-vite-canary` | `71c93678-1280-43bb-b3b6-1e711b992ef7` | SPA fallback serves the Vite fixture and extracted layers |
| `animus-vinext-canary` | `2b5bd59e-8efc-4e4e-8de1-a20be0fbccc5` | App, client, and Pages Router routes pass with extracted classes |
| `animus-react-router-canary` | `da3cb669-cfb9-4b4a-afbc-bb99205b89d0` | SSR and client routes pass with extracted classes |

The in-app dashboard browser remains signed out. The OAuth token can manage
Worker scripts but the official Builds API rejects `/builds/tokens` with error
10000 because Workers Builds Configuration uses a separate user-token scope.
Therefore the Git connection/build-command portion of OPS-1–OPS-4 remains open;
no build trigger was created or modified.

### Workers Builds connection observation — 2026-07-14 12:21 EDT

The authenticated dashboard session updated `animus` and connected
`codecaaron/animus` to all three canary Workers. Every service now uses root
directory `/`, production branch `main`, enabled non-production builds, include
watch path `*`, the shared `animus build token`, and enabled build caching. The
four build/deploy/version command triples match the table above exactly.

Cloudflare does not enqueue a build when an existing repository is first
connected. Each new service reports that a new Git commit is required to start
its first build, and the build-history view contains no manual branch-build
control. PR #72 currently points at commit
`c004b7602de1947c2a8c94b0f10a98dda27bcd91`; OPS-1–OPS-4 remain partial only
until a subsequent PR-branch push or merge to `main` supplies the required Git
event and the resulting builds pass.

**OPS-1** — expected: source inspection proves `/docs/start` is a real route,
and both remote requests contain `<title>Animus</title>`.

```bash
rg -n -F "path: '/docs/start'" packages/showcase/src/constants/docsNav.ts
curl -fsS https://animus.airrobb.workers.dev/ | rg -F '<title>Animus</title>'
curl -fsS https://animus.airrobb.workers.dev/docs/start | rg -F '<title>Animus</title>'
```

**OPS-2** — expected: the SPA fallback document contains the Vite title and
the extracted layer marker.

```bash
curl -fsS https://animus-vite-canary.airrobb.workers.dev/canary-route | rg -F '<title>Animus Vite Test App</title>'
curl -fsS https://animus-vite-canary.airrobb.workers.dev/canary-route | rg -F 'data-animus-layers'
```

**OPS-3** — expected: all three route markers appear.

```bash
curl -fsS https://animus-vinext-canary.airrobb.workers.dev/ | rg -F 'Vinext RSC canary'
curl -fsS https://animus-vinext-canary.airrobb.workers.dev/client | rg -F 'Vinext client boundary canary'
curl -fsS https://animus-vinext-canary.airrobb.workers.dev/legacy | rg -F 'Vinext Pages Router canary'
```

**OPS-4** — expected: initial server-rendered HTML contains the fixture marker.

```bash
curl -fsS https://animus-react-router-canary.airrobb.workers.dev/ | rg -F 'React Router v8 SSR canary'
curl -fsS https://animus-react-router-canary.airrobb.workers.dev/client | rg -F 'React Router v8 client canary'
```

### Git-connected cold-build closure — 2026-07-15 14:48 EDT

PR #72 commit `18b7bcde8c63` produced four successful Cloudflare preview checks.
The resulting preview versions were `40c9f9f9` (`animus`), `ea2e42cd`
(`animus-vite-canary`), `647a922a` (`animus-vinext-canary`), and `d495fb7d`
(`animus-react-router-canary`). A representative Vite build log showed the cold
Rust/QuickJS V2 compilation path completing in Cloudflare's clean Linux builder
and emitted 27.53 kB of strict-extraction CSS. The other preview artifacts also
contained non-empty extracted CSS (212,945, 8,560, and 8,560 bytes for showcase,
Vinext, and React Router respectively).

Fresh public smokes on 2026-07-15 confirmed the showcase root and `/docs/start`,
the Vite fallback plus `data-animus-layers`, all three Vinext route markers, and
both React Router route markers. The canaries intentionally have no production
health-check contract; fixture routes and extracted-style markers are the
behavioral proof. This closes OPS-1–OPS-4 and cross-cutting gate 2.1. It does not
prove the separate nightly GitHub Actions path or authorize disabling Cloudflare
Git Builds; those operations belong to `nightly-workers-deployment`.
