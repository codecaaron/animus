# Ops Runbook: add-workers-canary-matrix

| ID | External action | Owner / system | Ordering constraint | Rollback / repair | Close condition | Status |
| --- | --- | --- | --- | --- | --- | --- |
| OPS-1 | Update Worker `animus` to repository-root Workers Builds commands and deploy the checked-in showcase config | Cloudflare account `a9d267094b7ea8cff320f2bfcd2d28a6` / Workers Builds | After increment 06 local gates pass; Netlify is not an operational fallback | Restore the prior Build settings and promote the previous healthy Worker version | `external:animus-worker-matrix-live` observed: production build succeeds and root plus deep route respond with the showcase document | partial — deployed/smoked; Builds settings open |
| OPS-2 | Create Worker `animus-vite-canary`, connect `codecaaron/animus`, and enable non-production builds | Cloudflare account `a9d267094b7ea8cff320f2bfcd2d28a6` / Workers Builds | After increment 06 local gates pass | Delete the new canary Worker or promote its previous healthy version | `external:vite-worker-canary-live` observed: Git build succeeds, SPA route responds, and API marker responds | partial — created/deployed/smoked; Git connection open |
| OPS-3 | Create Worker `animus-vinext-canary`, connect `codecaaron/animus`, and enable non-production builds | Cloudflare account `a9d267094b7ea8cff320f2bfcd2d28a6` / Workers Builds | After increment 06 local gates pass | Delete the new canary Worker or promote its previous healthy version | `external:vinext-worker-canary-live` observed: Git build succeeds and App, client, and legacy route markers respond | partial — created/deployed/smoked; Git connection open |
| OPS-4 | Create Worker `animus-react-router-canary`, connect `codecaaron/animus`, and enable non-production builds | Cloudflare account `a9d267094b7ea8cff320f2bfcd2d28a6` / Workers Builds | After increment 06 local gates pass | Delete the new canary Worker or promote its previous healthy version | `external:react-router-worker-canary-live` observed: Git build succeeds and the SSR route marker responds | partial — created/deployed/smoked; Git connection open |

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
| `animus-vite-canary` | `71c93678-1280-43bb-b3b6-1e711b992ef7` | SPA fallback and `/api/health` pass |
| `animus-vinext-canary` | `2b5bd59e-8efc-4e4e-8de1-a20be0fbccc5` | App, client, and Pages Router routes pass with extracted classes |
| `animus-react-router-canary` | `da3cb669-cfb9-4b4a-afbc-bb99205b89d0` | SSR, client, and `/api/health` routes pass with extracted classes |

The in-app dashboard browser remains signed out. The OAuth token can manage
Worker scripts but the official Builds API rejects `/builds/tokens` with error
10000 because Workers Builds Configuration uses a separate user-token scope.
Therefore the Git connection/build-command portion of OPS-1–OPS-4 remains open;
no build trigger was created or modified.

**OPS-1** — expected: source inspection proves `/docs/start` is a real route,
and both remote requests contain `<title>Animus</title>`.

```bash
rg -n -F "path: '/docs/start'" packages/showcase/src/constants/docsNav.ts
curl -fsS https://animus.airrobb.workers.dev/ | rg -F '<title>Animus</title>'
curl -fsS https://animus.airrobb.workers.dev/docs/start | rg -F '<title>Animus</title>'
```

**OPS-2** — expected: document contains the Vite title and the health response
identifies the Vite canary and Cloudflare Worker runtime.

```bash
curl -fsS https://animus-vite-canary.airrobb.workers.dev/canary-route | rg -F '<title>Animus Vite Test App</title>'
curl -fsS https://animus-vite-canary.airrobb.workers.dev/api/health | rg -F '"app":"animus-vite-canary"'
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
```
