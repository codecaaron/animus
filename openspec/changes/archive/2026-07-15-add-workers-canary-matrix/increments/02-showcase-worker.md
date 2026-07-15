# Increment 02: Showcase Static Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Run no version-control command.

**Goal:** Make the existing showcase deployable as Worker `animus` through a
checked-in static-assets configuration with SPA fallback.

**Architecture:** The showcase remains a static Vite SPA. Its app-owned Wrangler
input points at the already verified `dist` directory; no Worker script is added.
The package-local Cloudflare scripts created by increment 01 discover this config
because Bun runs the command in the workspace directory.

**Tech Stack:** Vite, Cloudflare Workers Static Assets, Wrangler 4.110.0, Bun.

---

## Scope

- **Registry row**: 02 · mode: delegate · review: subagent
- **Resolves**: D1, D2 showcase leg, D3 static-assets leg, D7 local proof
- **Depends on**: increment 01 / D9
- **Footprint**: `packages/showcase/wrangler.jsonc`,
  `packages/showcase/package.json`, this packet
- **Pushes later**: repository orchestration and remote dashboard settings stay
  in row 06/2.1.
- **Prohibitions**: no source edits, no root Wrangler config, no deployment, no
  token/account secret, no Git commands, no writes to shared OpenSpec artifacts.

## Context capsule

- Increment 01 pinned Wrangler `4.110.0`, added `cf:deploy`, `cf:upload`, and
  `cf:dry-run` to the showcase manifest, and passed `verify:ci`.
- Worker identity is exactly `animus`.
- The SPA route smoke target is `/docs/start`; the corresponding source is
  `packages/showcase/src/content/start.mdx`.
- Cloudflare Static Assets requires `assets.directory` for a non-Vite-plugin
  assets-only Worker; `single-page-application` supplies deep-link fallback.
- Use compatibility date `2026-07-14`.

## Task 02.1: Reproduce the missing-entry failure

- [x] **Step 1:** Confirm the package scripts exist and no showcase Wrangler
  config exists.

  ```bash
  jq '.scripts | {deploy: .["cf:deploy"], upload: .["cf:upload"], dryRun: .["cf:dry-run"]}' packages/showcase/package.json
  test ! -e packages/showcase/wrangler.jsonc
  ```

  Expected: the three exact Wrangler commands print; the absence check exits 0.

- [x] **Step 2:** Run the credential-free deployment probe before adding config.

  ```bash
  bun run --filter @animus-ui/showcase cf:dry-run
  ```

  Expected RED: nonzero with Wrangler's missing entry-point/assets-directory
  diagnostic. Authentication failure is not the intended RED; if encountered,
  add `--dry-run` only by correcting the existing script contract.

## Task 02.2: Add the app-owned Static Assets config

- [x] **Step 1:** Create `packages/showcase/wrangler.jsonc` exactly as follows.

  ```jsonc
  {
    "$schema": "../../node_modules/wrangler/config-schema.json",
    "name": "animus",
    "compatibility_date": "2026-07-14",
    "assets": {
      "directory": "./dist",
      "not_found_handling": "single-page-application"
    }
  }
  ```

- [x] **Step 2:** Parse and assert the config without deployment.

  ```bash
  bun -e 'const c = await Bun.file("packages/showcase/wrangler.jsonc").json(); if (c.name !== "animus" || c.assets?.directory !== "./dist" || c.assets?.not_found_handling !== "single-page-application" || c.main) process.exit(1)'
  ```

  Expected: exit 0. A `main` field is a failure because this leg intentionally
  proves assets-only deployment.

## Task 02.3: Prove build, extraction, deep-link asset fallback, and dry run

- [x] **Step 1:** Run the existing focused build/assert oracle.

  ```bash
  vp run verify:showcase
  ```

  Expected: showcase build and positional CSS/JS assertions pass.

- [x] **Step 2:** Confirm the built SPA contains the source route and index.

  ```bash
  test -f packages/showcase/dist/index.html
  rg -n 'start-' packages/showcase/dist/index.html packages/showcase/dist/assets
  ```

  Expected: `index.html` exists and the lazy start content/chunk is referenced.

- [x] **Step 3:** Run the deployment dry run.

  ```bash
  bun run --filter @animus-ui/showcase cf:dry-run
  ```

  Expected GREEN: exit 0, Worker name `animus`, and an assets upload summary; no
  authentication is required and no remote state changes.

- [x] **Step 4:** Serve the checked-in config locally and exercise SPA fallback.

  ```bash
  cd packages/showcase
  bunx wrangler dev --port 8787
  curl -sS -D /tmp/animus-showcase-headers.txt -o /tmp/animus-showcase-docs-start.html -w '%{http_code}\n' http://127.0.0.1:8787/docs/start
  rg -n '<title>Animus</title>|<div id="root"></div>|data-animus-layers' /tmp/animus-showcase-docs-start.html
  ```

  Expected: status 200, `Content-Type: text/html`, Wrangler logs the
  `not_found_handling` navigation path, and the returned entry document contains
  all three Animus markers. Stop the local server after the assertion.

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
- [x] Record RED and GREEN dry-run summaries plus `verify:showcase` result.
- [x] Report all modified files; `packages/showcase/package.json` may remain
  untouched if its increment-01 scripts are already exact.
- [x] Proposed journal signal: showcase assets-only Worker config is locally
  reproducible and row 02 can close.
- [x] Proposed surprises and surfaced variables, or `none`.
- [x] Do not edit `design.md`, `tasks.md`, `journal.md`, or `specs/**`.

### Implementation record

- Preconditions: `jq` printed the exact increment-01 script contract
  (`wrangler deploy`, `wrangler versions upload`, and
  `wrangler deploy --dry-run`), and the showcase Wrangler config absence check
  exited 0.
- RED: the unconfigured `cf:dry-run` exited 1 with Wrangler's
  `Missing entry-point to Worker script or to assets directory` diagnostic and
  no authentication failure. Wrangler also reported a sandbox-only `EPERM`
  while attempting to write its debug log under
  `/Users/sugarat/Library/Preferences/.wrangler`; it still reached the intended
  missing-config diagnostic.
- Config GREEN: the checked-in JSONC parses with Worker name `animus`, assets
  directory `./dist`, SPA not-found handling, compatibility date `2026-07-14`,
  and no `main` field; the exact Bun assertion exited 0.
- Build/extraction: `vp run verify:showcase` exited 0. Vite built 2,059 modules,
  emitted `dist/index.html` and `dist/assets/start-D1nY32ph.js`, and the
  showcase positional assertion validated 1 CSS file and 34 JS files.
- SPA smoke: `dist/index.html` exists; the required `rg -n 'start-'` probe
  exited 0 and the built application map references `./content/start.mdx` and
  its `start-D1nY32ph.js` lazy chunk for `/docs/start`.
- Deployment GREEN: after granting Wrangler permission to write its standard
  user-level debug log, the exact `cf:dry-run` command exited 0. Wrangler
  4.110.0 read 37 assets, reported `Total Upload: 0.35 KiB / gzip: 0.24 KiB`,
  found no bindings, and printed `--dry-run: exiting now.` No remote state was
  changed; Worker identity `animus` is established by the parsed config.
- Runtime fallback GREEN: local Wrangler served `GET /docs/start` with status
  200 and `Content-Type: text/html; charset=utf-8`. Its request log explicitly
  reported `Sec-Fetch-Mode: navigate header present - using not_found_handling
  behavior`; the response contained `<title>Animus</title>`,
  `<div id="root"></div>`, and `data-animus-layers`. The server was stopped
  cleanly after the request.
- Guardrails: G1 found exactly one native Next plugin dependency line; G2 exited
  0; G3 produced empty output; G4 and G5 produced no matches (`rg` exit 1), as
  expected.
- Modified files: `packages/showcase/wrangler.jsonc` and this packet.
  `packages/showcase/package.json` remains untouched because its scripts were
  already exact.
- Proposed journal signal: `showcase assets-only Worker animus is locally
  reproducible: focused build/assert, /docs/start asset smoke, config assertion,
  deployment dry run, and G1-G5 all pass; row 02 can close.`
- Proposed surprise/tooling friction: Wrangler's default macOS debug-log path is
  outside the workspace sandbox and required permission escalation for the
  GREEN run. This did not require a repository or command-surface change.
- Surfaced variables: none.
