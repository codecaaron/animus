# Increment 03: Vite Full-Stack Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Run no version-control command.

**Goal:** Upgrade the existing Vite extraction fixture into Worker
`animus-vite-canary`, preserving its CSS oracle while adding a real workerd API
boundary.

**Architecture:** Cloudflare's Vite plugin builds both the existing React SPA
and a minimal Worker entry. Static/navigation requests keep SPA fallback; only
`/api/*` runs Worker-first. A unit test owns the Worker response contract while
the existing build assertion continues to own extraction output.

**Tech Stack:** Vite 8, React 18, `@cloudflare/vite-plugin` 1.44.0, Wrangler
4.110.0, Vitest, Animus Vite plugin.

---

## Scope

- **Registry row**: 03 · mode: delegate · review: subagent
- **Resolves**: D3 Cloudflare Vite adapter leg, D4 full-stack Vite boundary
- **Depends on**: increment 01 / D9
- **Footprint**: `e2e/vite-app/src/**`, `e2e/vite-app/worker/**`,
  `e2e/vite-app/scripts/**`, `e2e/vite-app/vite.config.ts`,
  `e2e/vite-app/wrangler.jsonc`, this packet
- **Pushes later**: root orchestration/Change-Type Map and remote Worker creation
  remain row 06/2.1.
- **Prohibitions**: no package manifest edits, no React alias, no root Wrangler
  config, no remote deployment, no Git commands, no shared OpenSpec edits.

## Context capsule

- Increment 01 pinned and installed Cloudflare Vite plugin `1.44.0` and added
  package-local Cloudflare scripts.
- Existing `vite.config.ts` has `react()` plus one `animusExtract()` instance,
  system `./src/ds.ts`, `verify: true`, and the v2-default escape hatch.
- Existing `scripts/assert-build.ts` recursively validates CSS/JS under `dist`;
  it must remain equally strict after Cloudflare changes the output layout.
- Worker identity: `animus-vite-canary`; compatibility date `2026-07-14`.
- API contract: `GET /api/health` returns status 200 and JSON
  `{ "app": "animus-vite-canary", "runtime": "cloudflare-worker" }`.

## Task 03.1: Add a failing Worker API test

- [x] **Step 1:** Create a compiling stub at `e2e/vite-app/worker/index.ts`.

  ```ts
  const worker = {
    async fetch(): Promise<Response> {
      return new Response(null, { status: 404 });
    },
  };

  export default worker;
  ```

- [x] **Step 2:** Create `e2e/vite-app/scripts/worker.test.ts`.

  ```ts
  import { describe, expect, it } from 'vitest';

  import worker from '../worker/index';

  describe('Vite canary Worker', () => {
    it('serves the health contract from workerd code', async () => {
      const response = await worker.fetch(
        new Request('https://animus-vite-canary.example/api/health')
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        app: 'animus-vite-canary',
        runtime: 'cloudflare-worker',
      });
    });

    it('does not claim non-API paths', async () => {
      const response = await worker.fetch(
        new Request('https://animus-vite-canary.example/not-an-api')
      );
      expect(response.status).toBe(404);
    });
  });
  ```

- [x] **Step 3:** Run RED.

  ```bash
  bunx vp test run e2e/vite-app/scripts/worker.test.ts
  ```

  Expected: one behavioral failure (`404` versus `200`), with the non-API test
  passing. Import/syntax failure is not an acceptable RED.

## Task 03.2: Implement Worker routing

- [x] **Step 1:** Replace the stub in `e2e/vite-app/worker/index.ts`.

  ```ts
  const worker = {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/api/health') {
        return Response.json({
          app: 'animus-vite-canary',
          runtime: 'cloudflare-worker',
        });
      }

      return new Response(null, { status: 404 });
    },
  };

  export default worker;
  ```

- [x] **Step 2:** Re-run the focused test.

  ```bash
  bunx vp test run e2e/vite-app/scripts/worker.test.ts
  ```

  Expected: 2/2 pass.

## Task 03.3: Compose Cloudflare and Animus in Vite

- [x] **Step 1:** Modify `e2e/vite-app/vite.config.ts` to import Cloudflare and
  add exactly one `cloudflare()` plugin while preserving the single existing
  `animusExtract()` options object.

  Resulting file:

  ```ts
  import { cloudflare } from '@cloudflare/vite-plugin';
  import { animusExtract } from '@animus-ui/vite-plugin';
  import react from '@vitejs/plugin-react';
  import { defineConfig } from 'vite';

  export default defineConfig({
    plugins: [
      react(),
      animusExtract({
        system: './src/ds.ts',
        verify: true,
        // Escape hatch (extract-v2-default-flip): ANIMUS_ENGINE=v1 vp run verify:vite
        engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
      }),
      cloudflare(),
    ],
  });
  ```

- [x] **Step 2:** Create `e2e/vite-app/wrangler.jsonc`.

  ```jsonc
  {
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "animus-vite-canary",
    "compatibility_date": "2026-07-14",
    "main": "./worker/index.ts",
    "assets": {
      "not_found_handling": "single-page-application",
      "run_worker_first": ["/api/*"]
    }
  }
  ```

- [x] **Step 3:** Assert app-owned routing fields.

  ```bash
  bun -e 'const c = await Bun.file("e2e/vite-app/wrangler.jsonc").json(); if (c.name !== "animus-vite-canary" || c.main !== "./worker/index.ts" || c.assets?.not_found_handling !== "single-page-application" || c.assets?.run_worker_first?.[0] !== "/api/*") process.exit(1)'
  ```

  Expected: exit 0.

## Task 03.4: Prove the full-stack build and deployment artifact

- [x] **Step 1:** Run the existing focused Vite build/assert tier.

  ```bash
  vp run verify:vite
  ```

  Expected: build succeeds with the Cloudflare client/Worker environments and
  all existing positional extraction assertions remain green.

- [x] **Step 2:** Locate and validate Cloudflare's generated deployment config.

  ```bash
  rg -l 'animus-vite-canary' e2e/vite-app/dist --glob 'wrangler.json'
  rg -n 'animus-vite-canary|worker/index|api/health' e2e/vite-app/dist
  ```

  Expected: a generated `wrangler.json` exists under `dist`; built Worker output
  contains the canary/API contract.

- [x] **Step 3:** Run the package deployment dry run.

  ```bash
  bun run --filter @animus-ui/vite-app cf:dry-run
  ```

  Expected: exit 0 and deployment summary for Worker plus static assets, without
  authentication or remote mutation.

- [x] **Step 4:** Serve the generated Worker locally and exercise SPA fallback
  with navigation semantics.

  ```bash
  cd e2e/vite-app
  bunx wrangler dev --port 8793 --ip 127.0.0.1
  curl -sS -H 'Sec-Fetch-Mode: navigate' -H 'Accept: text/html' \
    -D /tmp/animus-vite-canary-route.headers \
    -o /tmp/animus-vite-canary-route.html \
    http://127.0.0.1:8793/canary-route
  ```

  Expected: status 200, `Content-Type: text/html`, Vite entry-document markers,
  and a Wrangler routing log confirming `not_found_handling` handled the
  navigation request. Stop the server after the assertion.

## Guardrail gate

- [x] G1 native Next plugin retained:
  `rg -n -F '"@animus-ui/next-plugin": "workspace:*"' e2e/next-app/package.json`
- [x] G2 no root config: `test ! -e wrangler.jsonc`
- [x] G3 no duplicate names:
  `rg --glob 'wrangler.jsonc' -o '"name"[[:space:]]*:[[:space:]]*"[^"]+"' e2e packages | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)"/\1/' | sort | uniq -d`
- [x] G4 no packages→e2e imports:
  `rg -n "from ['\"][^'\"]*e2e/" packages`
- [x] G5 no token values:
  `rg -n --glob '*.json' --glob '*.jsonc' --glob '*.toml' '(CLOUDFLARE_API_TOKEN|CF_API_TOKEN).*[A-Za-z0-9_-]{20,}' e2e packages`

Expected: G1/G2 succeed; G3/G4/G5 output is empty.

## Output contract

- [x] Tick only completed packet checkboxes.
- [x] Record RED/GREEN Worker test, `verify:vite`, generated config, and dry-run
  evidence.
- [x] Report any Animus warning that is new relative to the pre-Cloudflare build;
  do not adapt the library from this footprint.
- [x] Proposed journal signal: Vite full-stack Worker boundary is locally proven.
- [x] Proposed surprises and surfaced variables, especially any multi-environment
  state symptom, or `none`.
- [x] Do not edit `design.md`, `tasks.md`, `journal.md`, or `specs/**`.

### Implementation record

- RED: `bunx vp test run e2e/vite-app/scripts/worker.test.ts` exited 1 with
  exactly one behavioral failure: the health test received status `404` instead
  of `200`. The non-API test passed, and there was no import or syntax failure.
- GREEN: after the minimal route implementation, the same focused command
  exited 0 with `2/2` tests passing. The route accepts only `GET /api/health`,
  returns the exact `animus-vite-canary` / `cloudflare-worker` JSON contract,
  and leaves every other request at `404`.
- Config GREEN: the Bun JSON assertion exited 0 for Worker name
  `animus-vite-canary`, source entry `./worker/index.ts`, SPA fallback, and
  `run_worker_first: ["/api/*"]`. Static inspection found exactly one
  `animusExtract()` instance, exactly one `cloudflare()` instance, and no React
  resolve alias.
- Build/extraction GREEN: `vp run verify:vite` exited 0. Vite built the
  `animus_vite_canary` Worker environment and the client environment; the
  existing positional assertion validated 2 CSS files and 3 JS files with all
  layer, variable, class-name, keyframe, placeholder, and Emotion checks green.
- Generated deployment config: `rg -l` found
  `e2e/vite-app/dist/animus_vite_canary/wrangler.json`. The generated config
  names `animus-vite-canary`, redirects `main` to `index.js`, points assets at
  `../client`, retains SPA fallback and `/api/*` Worker-first routing, and the
  built Worker contains `/api/health` plus both response marker values.
- Deployment GREEN: `bun run --filter @animus-ui/vite-app cf:dry-run` exited 0
  using the generated redirected config. Wrangler 4.110.0 read 5 assets,
  reported `Total Upload: 0.39 KiB / gzip: 0.27 KiB`, found no bindings, and
  printed `--dry-run: exiting now.` No remote state was changed.
- Workerd boundary GREEN: local Wrangler served `GET /api/health` with status
  200, `Content-Type: application/json`, and body
  `{"app":"animus-vite-canary","runtime":"cloudflare-worker"}` from the
  generated Worker; its request log reported `GET /api/health 200 OK`. The
  server then shut down cleanly.
- SPA fallback GREEN: a fresh local Wrangler session reused the generated
  redirected config at `dist/animus_vite_canary/wrangler.json`. A request to
  `/canary-route` with `Sec-Fetch-Mode: navigate` and `Accept: text/html`
  returned `HTTP/1.1 200 OK` and `Content-Type: text/html; charset=utf-8`. The
  response contained `data-animus-layers`,
  `<title>Animus Vite Test App</title>`, and `<div id="root"></div>`. Wrangler
  logged `GET /canary-route 200 OK (5ms) \`Sec-Fetch-Mode: navigate\` header
  present - using \`not_found_handling\` behavior`, and the server shut down
  cleanly. No production code or configuration change was required.
- Warnings: no new Animus warning category appeared relative to the existing
  fixture. The existing unused `StackItem` `row`-variant pruning warning was
  emitted once in each Cloudflare build environment. There was no Animus state
  collision, transform drift, missing-style symptom, or strict extraction
  error. Vite also printed plugin-react/optimization deprecation notices.
- Guardrails: G1 found exactly one native Next plugin dependency line; G2 and
  G3 exited 0 with no root config or duplicate Worker identity; G4 and G5 had
  no matches (`rg` exit 1), as expected.
- Modified source/config files: `e2e/vite-app/worker/index.ts`,
  `e2e/vite-app/scripts/worker.test.ts`, `e2e/vite-app/vite.config.ts`, and
  `e2e/vite-app/wrangler.jsonc`; this increment packet records the evidence.
  Existing extraction source and `scripts/assert-build.ts` remain untouched.
- Proposed journal signal: `Vite full-stack Worker animus-vite-canary is locally
  proven: Worker RED/GREEN, focused build/assert, generated deployment config,
  credential-free dry run, workerd GET /api/health smoke, navigation-semantic
  SPA fallback smoke, and G1-G5 pass.`
- Proposed tooling-friction entry: Wrangler's standard macOS debug-log path is
  outside the workspace sandbox. Build and dry-run still exited 0 after printing
  the log-write `EPERM`; the local workerd smoke additionally required scoped
  permission for that log and the loopback bind. No repository workaround was
  added.
- Surfaced variables: none. Multi-environment execution repeated only the known
  pruning warning and did not license an Animus library adaptation.
