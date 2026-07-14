## Why

The showcase already builds on Cloudflare but cannot deploy because Wrangler is
not given a Worker entry point or asset directory. Animus also needs deployment
evidence across the runtime boundaries its extraction plugins claim to support,
without sacrificing the native Next/webpack canary. A source-controlled,
multi-app Workers matrix makes deployment reproducible, catches adapter-specific
extraction failures, and removes the obsolete Netlify path.

## What Changes

- Add app-owned Cloudflare Worker configuration and monorepo-aware deployment commands.
- Deploy the showcase as an assets-only SPA Worker.
- Upgrade the Vite fixture to a full-stack React/Vite Worker canary.
- Add separate Vinext and React Router v8 Worker extraction canaries.
- Extend focused and composite verification to build, assert, and dry-run deployable canaries.
- Remove Netlify deployment configuration after Workers verification is established.

## Capabilities

### New Capabilities

- `workers-deployment-matrix`: App-owned Worker identities, deployment commands, static/full-stack routing contracts, and deployment verification.
- `vinext-extraction-canary`: A Vinext App/Pages Router consumer proving Animus extraction through RSC, SSR, client hydration, and Workers output.
- `react-router-extraction-canary`: A React Router v8 SSR consumer proving Animus extraction through Cloudflare's SSR Vite environment.

### Modified Capabilities

- `vite-test-app`: Extend the existing Vite extraction fixture with Cloudflare Worker execution and API/asset routing.
- `e2e-workspace-convention`: Register Vinext and React Router consumer applications as isolated `e2e/*` workspaces.
- `bun-workspace`: Include the new applications and replace the Netlify deployment command surface.
- `verification-tier-policy`: Add atomic and composite ownership for the new canary build/assert/deployment checks.

## Impact

Affected areas include root workspace metadata and lockfile, `.tool-versions`,
Node-version documentation, `vite.config.ts` task orchestration, root verification
policy documentation, `packages/showcase`,
`e2e/vite-app`, two new `e2e/*` applications, assertion/verification scripts,
and Cloudflare Workers Build settings. New development dependencies include
Wrangler, Cloudflare's Vite integration, Vinext/RSC tooling, and React Router v8.
The existing native Next app and published package APIs remain intact.
