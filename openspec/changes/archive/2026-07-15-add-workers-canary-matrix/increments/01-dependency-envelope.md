# Increment 01: Dependency Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Treat every checkpoint as logical;
> run no version-control command.

**Goal:** Resolve and lock one peer/engine-compatible dependency/script envelope
for the four Worker targets while registering the two new Bun workspaces and
raising the repository Node pin to React Router v8's supported floor.

**Architecture:** Deployment tooling is pinned once at the repository root.
Framework dependencies and commands live in the application that consumes them.
This increment creates package manifests only; framework source, Wrangler
configuration, and remote state belong to later increments.

**Tech Stack:** Bun workspaces, Wrangler, Cloudflare Vite plugin, Vinext, Vite
RSC plugin, React Router v8, React 18/19, Vitest.

---

## Scope

- **Registry row**: 01 · mode: inline · review: subagent
- **Resolves**: DEF-1 (exact deployment/framework version tuple), D7 (pinned
  deployment tooling, Node runtime, and app-owned dependencies), D8 (current
  release lines with exact pins; Vinext prerelease permitted)
- **Authors**: — (envelope requirements already cover this row)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `.tool-versions`, `AGENTS.md`, `CLAUDE.md`, `package.json`,
  `bun.lock`, `packages/showcase/package.json`, `e2e/vite-app/package.json`,
  `e2e/vinext-app/package.json`,
  `e2e/react-router-app/package.json`, `scripts/verify/workers-config.test.ts`
- **Pushes to a later increment**: Worker/source configuration and framework
  build compatibility remain in rows 02-06.

> Resolving signal that licensed creating this increment now: DEF-1 is
> envelope-licensed and self-resolving; current registry metadata plus the
> resulting `bun.lock` determine the exact tuple.

## Context Capsule

- **Objective**: Add the two new applications to the root workspace, pin
  Wrangler, raise Node from 22.18.0 to 22.22.0, add Cloudflare commands to the
  existing showcase/Vite apps, and create complete manifests for Vinext and
  React Router. `bun install` must produce one peer/engine-compatible lockfile
  without changing application source or adding Wrangler configs.
- **Repository constraints**:
  - Bun is the only package manager. Do not invoke npm, npx, yarn, or pnpm.
  - Migrated build/verification tasks are invoked with `vp run`; package-local
    deploy commands remain ordinary Bun scripts.
  - Never run mutative Git commands.
  - Use `apply_patch` for manual file edits; let `bun install` update `bun.lock`.
- **Current workspace facts**:
  - Root `package.json` explicitly lists `e2e/next-app` and `e2e/vite-app`.
  - `.tool-versions` pins Node 22.18.0; current React Router 8.2.0 and
    `@react-router/dev` 8.2.0 declare Node `>=22.22.0`.
  - Root development dependencies currently pin React 18.3.1 and Vite Plus but
    do not include Wrangler.
  - `packages/showcase` is a Vite SPA and currently has no Cloudflare scripts.
  - `e2e/vite-app` currently has `dev`, `build`, and `preview` scripts and uses
    React 18.
  - `@animus-ui/system` accepts React `^18 || ^19`; `@animus-ui/test-ds`
    accepts React `>=18`.
- **Required external packages to resolve**:
  - Root: `wrangler`.
  - Existing Vite app: `@cloudflare/vite-plugin`.
  - Vinext app: `vinext`, `@vinext/cloudflare`,
    `@cloudflare/vite-plugin`, `@vitejs/plugin-rsc`, `@vitejs/plugin-react`,
    `vite`, React, React DOM, `react-server-dom-webpack`, and matching React type
    packages. Current `vinext` `latest` is a prerelease and that is admissible
    for this exact-pinned compatibility canary.
  - React Router app: `react-router`, `@react-router/dev`,
    `@cloudflare/vite-plugin`, `vite`, React, React DOM, and matching React
    type packages.
- **Cloudflare script contract for every app**:

  ```json
  {
    "cf:deploy": "wrangler deploy",
    "cf:upload": "wrangler versions upload",
    "cf:dry-run": "wrangler deploy --dry-run"
  }
  ```

  Framework build commands run separately before these scripts. Running the
  script through `bun run --filter <workspace> ...` sets the application as the
  current directory so generated `.wrangler/deploy/config.json` redirects are
  discoverable.
- **Vinext package contract**:

  ```json
  {
    "name": "@animus-ui/vinext-app",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "vinext dev",
      "build": "vinext build",
      "start": "vinext start",
      "check": "vinext check",
      "cf:deploy": "wrangler deploy",
      "cf:upload": "wrangler versions upload",
      "cf:dry-run": "wrangler deploy --dry-run"
    }
  }
  ```

- **React Router package contract**:

  ```json
  {
    "name": "@animus-ui/react-router-app",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "react-router dev",
      "build": "react-router build",
      "preview": "vite preview",
      "typecheck": "react-router typegen && tsgo --noEmit",
      "cf:deploy": "wrangler deploy",
      "cf:upload": "wrangler versions upload",
      "cf:dry-run": "wrangler deploy --dry-run"
    }
  }
  ```

- **In-scope guardrails**:
  - G1: native Next SHALL retain its direct next-plugin dependency — check:
    `rg -n -F '"@animus-ui/next-plugin": "workspace:*"' e2e/next-app/package.json`
    — STOP.
  - G2: SHALL NOT add root `wrangler.jsonc` — check:
    `test ! -e wrangler.jsonc` — STOP.
  - G3: Wrangler configs SHALL NOT reuse a name — check:
    `rg --glob 'wrangler.jsonc' -o '"name"[[:space:]]*:[[:space:]]*"[^"]+"' e2e packages | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)"/\1/' | sort | uniq -d`
    — STOP; expected empty.
  - G4: active packages SHALL NOT import e2e source — check:
    `rg -n "from ['\"][^'\"]*e2e/" packages` — STOP; expected empty.
  - G5: checked-in config SHALL NOT contain API token values — check:
    `rg -n --glob '*.json' --glob '*.jsonc' --glob '*.toml' '(CLOUDFLARE_API_TOKEN|CF_API_TOKEN).*[A-Za-z0-9_-]{20,}' e2e packages`
    — STOP; expected empty.
- **Existing spec context**: envelope requirements
  `§bun-workspace/Worker canary workspace membership`,
  `§bun-workspace/Explicit Worker command surface`, and
  `§workers-deployment-matrix/Workers are reproducible from repository commands`.
- **Relevant resolved decisions**: app dependencies are local; Wrangler is
  pinned at root; Node is raised to 22.22.0; current framework `latest` tags are
  exact-pinned even when Vinext is prerelease; app commands execute in the owning
  workspace; no root Wrangler config is created.
- **In-scope North Star criteria**: NS2 (local app ownership, centralized
  orchestration), NS4 (clean-checkout reproducibility), NS5 (no e2e imports from
  libraries).
- **Prohibitions**: no version-control commands; no writes outside the footprint
  plus this packet; do not write `design.md`, `tasks.md`, `journal.md`, or
  `specs/`; do not add framework source/config files yet.

## Plan

## Task 01.1: Resolve the current peer-compatible tuple

- [x] **Step 1:** Query current version, peer, optional-peer, and engine metadata
  without editing manifests.

  Run each command from the repository root:

  ```bash
  bun info wrangler --json | jq '{version, peerDependencies, peerDependenciesMeta, engines}'
  bun info @cloudflare/vite-plugin --json | jq '{version, peerDependencies, peerDependenciesMeta, engines}'
  bun info vinext --json | jq '{version, peerDependencies, peerDependenciesMeta, engines}'
  bun info @vinext/cloudflare --json | jq '{version, peerDependencies, peerDependenciesMeta, engines}'
  bun info @vitejs/plugin-rsc --json | jq '{version, peerDependencies, peerDependenciesMeta, engines}'
  bun info @vitejs/plugin-react --json | jq '{version, peerDependencies, peerDependenciesMeta, engines}'
  bun info react-router --json | jq '{version, peerDependencies, peerDependenciesMeta, engines}'
  bun info @react-router/dev --json | jq '{version, peerDependencies, peerDependenciesMeta, engines}'
  bun info react-server-dom-webpack --json | jq '{version, peerDependencies, peerDependenciesMeta, engines}'
  ```

  Expected: every command exits 0 and prints all present metadata fields. Record
  the exact current versions and select one tuple satisfying Vinext's
  React/Vite/RSC/plugin-react peers, React Router's React/Vite peers, and every
  Node engine. The current Vinext `latest` prerelease is allowed. Keep the
  existing Vite app on React 18; use React 19 only in the two new framework apps
  when required by their current peers.

- [x] **Step 2:** Confirm the selected external versions contain no range prefix
  (`^`, `~`, `>`, `<`, `*`) and that workspace packages remain `workspace:*`.

## Task 01.2: Add a failing manifest contract test

- [x] **Step 1:** Create `scripts/verify/workers-config.test.ts` with this test:

  ```ts
  import { existsSync, readFileSync } from 'node:fs';
  import { resolve } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const ROOT = resolve(import.meta.dirname, '../..');

  type Manifest = {
    name?: string;
    private?: boolean;
    type?: string;
    workspaces?: string[];
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  function manifest(path: string): Manifest {
    const absolute = resolve(ROOT, path);
    expect(existsSync(absolute), `${path} must exist`).toBe(true);
    return JSON.parse(readFileSync(absolute, 'utf8')) as Manifest;
  }

  function expectPinned(value: string | undefined, label: string): void {
    expect(value, `${label} must be declared`).toBeTruthy();
    expect(value, `${label} must be exact`).not.toMatch(/^[~^*<>]/);
  }

  const cloudflareScripts = {
    'cf:deploy': 'wrangler deploy',
    'cf:upload': 'wrangler versions upload',
    'cf:dry-run': 'wrangler deploy --dry-run',
  };

  describe('Workers canary package envelope', () => {
    it('registers both new applications and pins Wrangler and Node', () => {
      const root = manifest('package.json');
      expect(root.workspaces).toContain('e2e/vinext-app');
      expect(root.workspaces).toContain('e2e/react-router-app');
      expectPinned(root.devDependencies?.wrangler, 'wrangler');
      expect(readFileSync(resolve(ROOT, '.tool-versions'), 'utf8')).toMatch(
        /^nodejs 22\.22\.0$/m
      );
    });

    it.each(['packages/showcase', 'e2e/vite-app'])(
      '%s exposes Cloudflare commands',
      (path) => {
        expect(manifest(`${path}/package.json`).scripts).toMatchObject(
          cloudflareScripts
        );
      }
    );

    it('defines a pinned Vinext workspace envelope', () => {
      const app = manifest('e2e/vinext-app/package.json');
      expect(app).toMatchObject({
        name: '@animus-ui/vinext-app',
        private: true,
        type: 'module',
      });
      expect(app.scripts).toMatchObject({
        dev: 'vinext dev',
        build: 'vinext build',
        start: 'vinext start',
        check: 'vinext check',
        ...cloudflareScripts,
      });
      for (const name of [
        'vinext',
        '@vinext/cloudflare',
        '@cloudflare/vite-plugin',
        '@vitejs/plugin-rsc',
        '@vitejs/plugin-react',
        'vite',
        'react',
        'react-dom',
        'react-server-dom-webpack',
      ]) {
        expectPinned(
          app.dependencies?.[name] ?? app.devDependencies?.[name],
          `vinext-app ${name}`
        );
      }
      expect(app.dependencies).toMatchObject({
        '@animus-ui/system': 'workspace:*',
        '@animus-ui/test-ds': 'workspace:*',
        '@animus-ui/vite-plugin': 'workspace:*',
      });
    });

    it('defines a pinned React Router workspace envelope', () => {
      const app = manifest('e2e/react-router-app/package.json');
      expect(app).toMatchObject({
        name: '@animus-ui/react-router-app',
        private: true,
        type: 'module',
      });
      expect(app.scripts).toMatchObject({
        dev: 'react-router dev',
        build: 'react-router build',
        preview: 'vite preview',
        typecheck: 'react-router typegen && tsgo --noEmit',
        ...cloudflareScripts,
      });
      for (const name of [
        'react-router',
        '@react-router/dev',
        '@cloudflare/vite-plugin',
        'vite',
        'react',
        'react-dom',
      ]) {
        expectPinned(
          app.dependencies?.[name] ?? app.devDependencies?.[name],
          `react-router-app ${name}`
        );
      }
      expect(app.dependencies).toMatchObject({
        '@animus-ui/system': 'workspace:*',
        '@animus-ui/test-ds': 'workspace:*',
        '@animus-ui/vite-plugin': 'workspace:*',
      });
    });
  });
  ```

- [x] **Step 2:** Run the focused test and verify RED.

  ```bash
  bunx vp test run scripts/verify/workers-config.test.ts
  ```

  Expected: FAIL on the Node pin, missing new workspace entries/manifests, and
  Wrangler. A syntax/import error is not an acceptable RED result; correct the
  test until it fails on those absent contracts.

## Task 01.3: Implement the workspace manifests

- [x] **Step 1:** Update `.tool-versions` from Node 22.18.0 to 22.22.0 and update
  the matching Node minimum in `AGENTS.md` and `CLAUDE.md`. Update root
  `package.json` with explicit `e2e/vinext-app`/`e2e/react-router-app` workspace
  entries and the selected exact Wrangler dev dependency.
- [x] **Step 2:** Add the three Cloudflare scripts from the Context Capsule to
  `packages/showcase/package.json` and `e2e/vite-app/package.json`; add the
  selected exact `@cloudflare/vite-plugin` version to the Vite app.
- [x] **Step 3:** Create `e2e/vinext-app/package.json` with the exact package
  contract from the Context Capsule, workspace Animus dependencies, selected
  pinned Vinext/Cloudflare/RSC/plugin-react/React dependencies, matching React
  type packages, and `@animus-ui/assertions: workspace:*` for later output
  assertions.
- [x] **Step 4:** Create `e2e/react-router-app/package.json` with the exact
  package contract from the Context Capsule, workspace Animus dependencies,
  selected pinned React Router/Cloudflare/React dependencies, matching React
  type packages, and `@animus-ui/assertions: workspace:*`.
- [x] **Step 5:** Run `bun install` from the repository root to update
  `bun.lock` and install the exact graph.

  ```bash
  bun install
  ```

  Expected: exit 0 with no unresolved peer dependency or missing-package error.
  Do not switch package managers if network or registry access fails; request
  the required execution permission and retry the same Bun command.

## Task 01.4: Verify GREEN and lockfile reproducibility

- [x] **Step 1:** Re-run the focused manifest test.

  ```bash
  bunx vp test run scripts/verify/workers-config.test.ts
  ```

  Expected: all four tests pass.

- [x] **Step 2:** Verify the lockfile is sufficient without mutation.

  ```bash
  bun install --frozen-lockfile
  ```

  Expected: exit 0 and report no lockfile update.

- [x] **Step 3:** Run the repository CI mirror required by the Change-Type Map
  for `.tool-versions` changes.

  ```bash
  vp run verify:ci
  ```

  Expected: exit 0.

## Guardrail gate

- [x] G1:
  `rg -n -F '"@animus-ui/next-plugin": "workspace:*"' e2e/next-app/package.json`
  — result: one dependency line
- [x] G2: `test ! -e wrangler.jsonc` — result: exit 0
- [x] G3:
  `rg --glob 'wrangler.jsonc' -o '"name"[[:space:]]*:[[:space:]]*"[^"]+"' e2e packages | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)"/\1/' | sort | uniq -d`
  — result: empty output
- [x] G4: `rg -n "from ['\"][^'\"]*e2e/" packages` — result: empty output
- [x] G5:
  `rg -n --glob '*.json' --glob '*.jsonc' --glob '*.toml' '(CLOUDFLARE_API_TOKEN|CF_API_TOKEN).*[A-Za-z0-9_-]{20,}' e2e packages`
  — result: empty output

## Output contract

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Record the exact selected dependency tuple and relevant peer/optional-peer/
  engine constraints
- [x] Record focused test, frozen install, `verify:ci`, and guardrail results
- [x] Proposed journal entry: `signal` citing DEF-1 and the successful locked
  dependency graph
- [x] Proposed journal entries for any surprise or tooling friction
- [x] Surfaced variables: decision-shaped unknowns with a resolving signal, or
  `none`

### Implementation record

- Selected tuple: Node `22.22.0`; Wrangler `4.110.0` (Node `>=22`, optional
  `@cloudflare/workers-types` peer); Cloudflare Vite plugin `1.44.0` (Vite
  `^6.1 || ^7 || ^8`, Wrangler `^4.110.0`); Vite `8.1.4` (Node `^20.19 ||
  >=22.12`); Vinext and `@vinext/cloudflare` `1.0.0-beta.1` (Node `>=22`);
  React plugin `6.0.3`; RSC plugin `0.5.27`; React, React DOM, and
  `react-server-dom-webpack` `19.2.7`; React Router and `@react-router/dev`
  `8.2.0` (Node `>=22.22.0`); React types `19.2.17` and React DOM types
  `19.2.3`.
- Peer fit: Vinext accepts React/RSC `^19.2.6`, React plugin `^5.1.4 || ^6`,
  RSC plugin `^0.5.26`, and Vite `^8`; React Router accepts React `>=19.2.7`,
  while its dev package accepts RSC plugin `~0.5.26`, Vite `^7 || ^8`, and
  Wrangler `^4`. The selected versions satisfy those ranges. One accepted
  metadata exception remains: `@vinext/cloudflare@1.0.0-beta.1` declares
  `vinext >=0.0.0`, a range that does not opt into the coordinated Vinext beta.
  Row 04's production build is the required runtime proof for this exception.
- RED: the focused contract test failed all five cases on the missing
  workspaces, manifests, scripts, Wrangler pin, and Node pin.
- Review correction RED: five non-SemVer selectors (`latest`, `beta`, `8.x`, a
  file path, and a URL) escaped the initial range-prefix-only assertion.
- GREEN: the strengthened focused contract test passed `11/11`, including exact
  D9 tuple/type pins and negative selector cases; frozen install checked 714
  installs across 1,032 packages with no changes; `vp run verify:ci` completed
  all 17 tasks with zero failures and zero cache hits.
- Guardrails: G1/G2/G3 passed with exit 0; G4/G5 produced the required empty
  output (`rg` exit 1 for no matches).
- Proposed signal: `DEF-1 resolved by the exact locked dependency graph and
  accepted Vinext prerelease peer-metadata exception above; authorize rows
  02–04 packet materialization. Row 05 remains lazy until row 04 completes.`
- Tooling friction: Bun's initial resolver warns that
  `@vinext/cloudflare@1.0.0-beta.1` has an incorrect Vinext peer because its
  published `>=0.0.0` range does not opt into prereleases. `bun pm why vinext`
  shows the matching beta peer resolved, and the frozen install is clean.
- Surfaced variables: none. Framework-source compatibility is intentionally
  proven by rows 02–05.

## Spec authorship checklist (orchestrator)

- [x] Confirm the envelope specs cover the completed manifest behavior; no new
  spec text is owed
- [x] Flip DEF-1 to `resolved → D9` and add D9 with the exact tuple to
  `design.md`; retain D8 as the release-line policy
- [x] Append accepted journal entries, attributed to the implementer/reviewer
- [x] Write the increment-01 full reorientation entry
- [x] Tick registry row 01 with its reorientation timestamp
