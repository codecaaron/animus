## Context

Animus is a Bun workspace whose extraction libraries are consumed by a complex
Vite showcase and minimal Next/Vite end-to-end applications. Cloudflare Workers
Builds currently compiles `packages/showcase` but deploys from that directory
without a Worker entry point or static-assets configuration, so Wrangler exits
with “Missing entry-point.” The dashboard compensates for a package-local root
with `cd ../..` and lockfile-copy commands.

The deployment target is now a matrix rather than a single site. The existing
Next application must remain the native `@animus-ui/next-plugin`/webpack oracle,
while Workers coverage adds assets-only, Vite+workerd, Vinext RSC/SSR, and React
Router v8 SSR paths. Current React Router v8 requires Node 22.22 or newer while
the repository pins Node 22.18, so the dependency envelope includes a runtime
pin update. Repository policy requires Bun package management, `vp run`
orchestration, explicit verification ownership for new `e2e/*` surfaces, and no
mutative Git operations.

Stakeholders are Animus maintainers, contributors relying on the canaries as
release evidence, and the Cloudflare account that owns Worker `animus`.

## Goals / Non-Goals

**Goals:**

- Make the showcase and Vite canary reproducibly deployable to distinct Workers.
- Add independent Vinext and React Router v8 extraction canaries, each deployable
  to its own Worker.
- Preserve and continue verifying the native Next canary.
- Check in app-owned Worker configuration and monorepo-aware build/deploy commands.
- Add focused build/assert/dry-run verification and register every new edit surface.
- Remove Netlify configuration once the Workers path is locally proven.

**Non-Goals:**

- Deploy the native Next canary through OpenNext.
- Add Astro, TanStack Start, bindings, databases, queues, service bindings, custom
  domains, or production caching.
- Generalize Animus into a framework adapter abstraction before a canary proves it
  necessary.
- Replace Cloudflare Workers Builds with a separate CI deployment workflow.
- Weaken existing structural CSS assertions to accommodate a framework adapter.

## Decisions

### D1: App-owned Worker configuration with repo-root build context

- **Choice**: Each deployable app owns `wrangler.jsonc` and package-local
  Cloudflare commands. Every Git-connected Worker uses the repository root as its
  Workers Builds root, invokes the app's dependency-aware `vp` build task, and
  dispatches deploy/version commands into that app workspace.
- **Rationale**: This gives every Worker an unambiguous owner and identity while
  keeping the one lockfile, workspace dependencies, and package build graph in
  scope. Framework-generated deployment configuration is discovered because the
  final command executes with the app as its current directory.
- **Alternatives considered**: One root Wrangler config conflates applications;
  package-local Workers Build roots require `cd ../..`, hide workspace tooling,
  and recreate the current lockfile workaround; dashboard-only asset flags drift
  from source control.

### D2: Four deployable runtime boundaries plus one preserved build oracle

- **Choice**: The Worker matrix is `packages/showcase` → `animus`,
  `e2e/vite-app` → `animus-vite-canary`, `e2e/vinext-app` →
  `animus-vinext-canary`, and `e2e/react-router-app` →
  `animus-react-router-canary`. `e2e/next-app` remains build-only.
- **Rationale**: Each deployed app proves a distinct hosting/framework boundary;
  preserving native Next retains webpack adapter coverage that Vinext cannot
  provide.
- **Alternatives considered**: Converting the Next fixture loses next-plugin
  coverage; deploying both showcase and an unchanged static Vite app duplicates
  only asset-upload behavior; adding every supported framework creates low-value
  maintenance breadth.

### D3: Use each framework's native Cloudflare adapter

- **Choice**: The showcase uses Workers Static Assets with SPA fallback. The Vite
  and React Router apps use `@cloudflare/vite-plugin`. Vinext uses its Cloudflare
  integration with `@vitejs/plugin-rsc` and the Cloudflare Vite plugin. Framework
  build output, including generated Wrangler deployment redirects, remains owned
  by the adapter.
- **Rationale**: Native adapters exercise workerd-compatible builds and avoid
  hand-maintaining generated worker entry points.
- **Alternatives considered**: Treating all apps as static assets would not test
  SSR/RSC or Worker execution; handwritten Worker bundles duplicate framework
  adapters and are more likely to drift.

### D4: Upgrade the Vite fixture to a full-stack Worker canary

- **Choice**: Retain its existing extraction source and assertions, add a minimal
  Worker entry/API route, add the Cloudflare Vite plugin, and keep SPA fallback
  for non-API paths.
- **Rationale**: The showcase already proves a substantial static Vite build. A
  Worker endpoint makes the smaller Vite canary prove asset/Worker routing and
  plugin coexistence.
- **Alternatives considered**: Adding a second Vite fixture duplicates sources;
  keeping it static adds no runtime boundary.

### D5: Add self-contained Vinext and React Router fixtures

- **Choice**: New apps may copy the minimum design-system/component patterns from
  the existing canaries but SHALL NOT import another `e2e/*` app. Vinext starts
  with behaviorally equivalent App and Pages Router cases from the native Next
  fixture, including an RSC page and client boundary. React Router covers SSR
  route modules and a client-hydrated interaction.
- **Rationale**: Self-contained fixtures obey the one-way dependency rule and
  make failures attributable to the framework under test. Mirroring both Next
  router families makes the Vinext comparison honest.
- **Alternatives considered**: Cross-fixture imports couple build graphs and make
  package roots porous; testing only trivial text would not exercise extraction;
  replacing the native fixture removes the comparison baseline.

### D6: Verification is framework output plus deployment evidence

- **Choice**: Each new canary receives atomic build and assert tiers. Assertions
  inspect emitted CSS/JS and framework-specific output. Credential-free Wrangler
  or Vinext dry runs validate deployment configuration. Full-stack targets also
  receive an HTTP smoke against their built Worker locally or, when authenticated
  deployment is authorized, against the created `workers.dev` URL.
- **Rationale**: A successful compiler exit does not prove extracted CSS exists,
  a Worker bundle is deployable, or the request path executes.
- **Alternatives considered**: Build-only checks repeat the failure mode that
  exposed this change; remote-only checks are slow, credentialed, and unsuitable
  as the sole local gate.

### D7: Pin deployment tooling and remove Netlify after local proof

- **Choice**: Pin Wrangler at the workspace root so Workers Builds uses the locked
  version; pin framework adapters in their owning apps; raise the repository Node
  pin to at least 22.22 when required by the selected React Router v8 release.
  Replace the Netlify root deploy command with explicit Worker commands and delete
  `netlify.toml` after the complete local Worker matrix passes.
- **Rationale**: Reproducible tooling is necessary because Cloudflare uses the
  Wrangler version in `package.json`, and framework engine constraints must match
  CI's `.tool-versions` runtime. The existing Netlify command targets a removed
  root script and is not an operational rollback path; Cloudflare's previous
  healthy Worker version is the rollback for `animus`.
- **Alternatives considered**: Ephemeral latest-version `bunx` installs make CI
  non-reproducible; selecting a React Router v8 release whose engine exceeds the
  repository pin creates a build-time failure; retaining stale Netlify metadata
  presents a false fallback.

### D8: Canaries track current framework release lines with exact pins

- **Choice**: Resolve the current `latest` dist-tags and pin the compatible tuple
  exactly. A Vinext prerelease is admissible when the current official `latest`
  line is prerelease; the lockfile, engine fields, peer dependencies, and required
  peers remain mandatory evidence.
- **Rationale**: These applications are compatibility canaries for current
  framework integrations. Exact pins make failures reproducible while permitting
  early detection against Vinext's actively recommended release line.
- **Alternatives considered**: Forcing the older Vinext stable line reduces the
  canary's relevance; floating ranges make failures nondeterministic.

### D9: Lock the Vite 8 / React 19 Worker-canary dependency envelope

- **Choice**: Require Node `>=22.22.0` for the selected framework graph and pin
  Wrangler `4.110.0`, Cloudflare Vite plugin
  `1.44.0`, Vite `8.1.4`, Vinext and its Cloudflare adapter
  `1.0.0-beta.1`, React plugin `6.0.3`, RSC plugin `0.5.27`, React/React DOM/
  React Server DOM Webpack `19.2.7`, React Router and its dev package `8.2.0`,
  and React/React DOM types `19.2.17`/`19.2.3`. Keep the existing Vite canary
  on React 18. D12 supersedes this decision's initial operational Node pin with
  Node `24.18.0` LTS without changing the dependency tuple.
- **Rationale**: Registry engines and peers admit one exact graph across Vinext,
  React Router v8, Vite 8, and Cloudflare's adapter, while app-local manifests
  isolate React 19 from existing React 18 consumers. The lockfile, focused
  11-case contract, frozen install, and clean `verify:ci` make the envelope
  reproducible.
- **Accepted metadata exception**: `@vinext/cloudflare@1.0.0-beta.1` declares
  `vinext >=0.0.0`, which semver does not extend to the coordinated
  `vinext@1.0.0-beta.1` prerelease. Bun resolves the exact matching beta peer
  but warns on the first install. The frozen graph is stable, and increment 04's
  production build, deployment dry run, and workerd runtime proof passed.
- **Alternatives considered**: Patching upstream peer metadata adds local
  package drift; selecting an older stable Vinext line weakens the current-line
  compatibility canary; floating tags make deployments nondeterministic.

### D10: Retain Vinext's hybrid App+Pages Router surface

- **Choice**: Keep one self-contained Vinext canary with App Router RSC and
  client-boundary routes plus a Pages Router SSR route. Vinext owns RSC setup;
  Cloudflare runs the `rsc` environment with `ssr` as its child; Animus remains
  one unadapted plugin instance.
- **Rationale**: `vinext check`, the five-environment production build, hybrid
  Pages build, artifact assertions, deployment dry run, three live workerd
  routes, and a React 19 hydration interaction all pass. This positively
  resolves DEF-3 and functionally proves D9's accepted peer-metadata exception.
- **Accepted beta diagnostics**: Vinext reports partial App Router
  `reactStrictMode` support and emits one identical hashed CSS filename twice.
  Complete extracted CSS, route markers, live Animus classes, and hydration
  behavior show neither diagnostic is an Animus state or transform failure.
- **Alternatives considered**: App-only coverage would lose the comparison with
  the native hybrid Next oracle; separate App and Pages Workers would add
  deployment breadth without testing a distinct extraction boundary.

### D11: Keep Animus's current per-instance Vite lifecycle

- **Choice**: Make no multi-environment adaptation in `@animus-ui/vite-plugin`.
  Framework canaries each retain one ordinary plugin instance and rely on Vite's
  environment lifecycle as implemented today.
- **Rationale**: Vinext's RSC/client/SSR/hybrid build and React Router's
  client/SSR build both emit complete, asserted CSS and live Animus classes with
  no state collision, transform drift, missing transform, or strict extraction
  failure. React Router emits the same 8.56 kB stylesheet content in client and
  SSR output. DEF-2 therefore resolves without a library change.
- **Alternatives considered**: Adding shared or per-environment state machinery
  without a failing reproduction would increase plugin complexity and risk the
  existing Vite/showcase oracles. A future concrete failure must reopen this
  decision with a focused Vite-plugin test first.

### D12: Make Git-connected Worker builds provision V2 from source

- **Choice**: Pin Node `24.18.0` through both `.tool-versions` and Cloudflare's
  recognized `.node-version`; keep Bun `1.3.11`; and make every public Worker
  build depend on a shared V2 extraction task. That task installs the repository's
  pinned Rust `1.97.0` toolchain only when `WORKERS_CI=1` and Cargo is absent,
  then compiles the V2 NAPI binary from the checked-out source. All four Worker
  fixtures run extraction with verification and strict failure enabled.
- **Rationale**: The first Git-triggered builds proved that local NAPI artifacts
  had hidden a disconnected production-build dependency. Source compilation
  couples the Linux binary to the exact checkout, while Node 24 is the current
  LTS line and `.node-version` is understood by Workers Builds. Strict mode
  prevents showcase and Vite from turning extraction failure into a successful
  deployment with empty CSS.
- **Alternatives considered**: Shipping a prebuilt binary requires a new
  revision-addressed artifact channel; switching to V1 abandons the V2 cutover;
  removing strict mode preserves false-green deployments; Node 26 is Current,
  not LTS.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Every deployed canary proves a distinct framework/runtime boundary,
  not merely another static-directory upload.
- **NS2**: Deployment ownership stays local to an application while monorepo
  dependency orchestration stays centralized and explicit.
- **NS3**: Existing extraction oracles remain at least as strict as before
  Workers support.
- **NS4**: A clean checkout can reproduce every production build and deployment
  dry run without dashboard-only path knowledge.
- **NS5**: Framework adapters remain consumer-side; active libraries never depend
  on `e2e/*`.
- **NS6**: One Worker per app is provisional — revisit when
  `external:multi-worker-runtime-requirement` demonstrates a service-binding or
  multi-Worker topology that a single app Worker cannot express.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Exact Wrangler, Vinext, React, React Router, and Cloudflare adapter version tuple | resolved → D9 | 01 | Exact graph locked; 11-case pin contract, frozen install, and `verify:ci` pass; coordinated Vinext beta peer-metadata exception accepted | resolved 2026-07-14 |
| DEF-2 | Whether Animus needs a multi-environment plugin adaptation | resolved → D11 | 05 | Vinext and React Router multi-environment builds/assertions/runtime pass with the unmodified plugin | resolved 2026-07-14 |
| DEF-3 | Whether Vinext can retain the native canary's hybrid App+Pages surface | resolved → D10 | 04 | Hybrid check/build/assert/dry-run, three workerd routes, and client hydration pass; D9 metadata exception proven | resolved 2026-07-14 |
| DEF-4 | Creation and Git connection of the three new remote Workers | resolved → D1/D2 | 2.1 | Four independent Workers exist, all three canaries are connected to `codecaaron/animus`, and exact root build settings are live | resolved 2026-07-14 |
| DEF-5 | Preview-branch routes and custom domains | deferred | external:workers-canaries-live | Each production Worker exists and a non-production versions upload returns a preview URL | 3 reorientations \| 2026-08-14 |
| DEF-6 | Astro React-island canary | deferred | external:astro-consumer-signal | A real Astro consumer or extraction failure across `.astro` → `.tsx` boundaries exists | 3 reorientations \| 2026-10-14 |
| DEF-7 | TanStack Start canary | deferred | external:tanstack-divergence-signal | Its Workers/Vite integration materially diverges from the React Router SSR environment or a real consumer adopts it | 3 reorientations \| 2026-10-14 |
| DEF-8 | Native Next Worker deployment via OpenNext | deferred | external:native-next-worker-requirement | Release requirements demand runtime portability proof for `@animus-ui/next-plugin` output | 3 reorientations \| 2026-10-14 |

## Guardrail Register

| ID | Invariant (SHALL NOT ...) | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT remove the native Next canary's direct `@animus-ui/next-plugin` dependency; blind spot: this check does not prove runtime plugin invocation | all | STOP | active |
| G2 | The change SHALL NOT add an ambiguous repository-root `wrangler.jsonc` | all | STOP | active |
| G3 | App Wrangler configs SHALL NOT reuse a Worker name; blind spot: an empty config set passes | all | STOP | active |
| G4 | Active `packages/*` code SHALL NOT import `e2e/*`; blind spot: computed/dynamic paths may escape the textual scan | all | STOP | active |
| G5 | Checked-in JSON/JSONC/TOML SHALL NOT contain a Cloudflare API token value; variable names and non-secret account IDs are allowed | all | STOP | active |
| G6 | The completed change SHALL NOT retain active Netlify configuration or commands | change-end | STOP | proposed |

Checks — verbatim commands, one fenced block per row:

**G1** — expected: one dependency line. Calibrated 2026-07-14: one line.

```bash
rg -n -F '"@animus-ui/next-plugin": "workspace:*"' e2e/next-app/package.json
```

**G2** — expected: exit 0. Calibrated 2026-07-14: exit 0.

```bash
test ! -e wrangler.jsonc
```

**G3** — expected: empty output. Calibrated 2026-07-14: empty output.

```bash
rg --glob 'wrangler.jsonc' -o '"name"[[:space:]]*:[[:space:]]*"[^"]+"' e2e packages | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)"/\1/' | sort | uniq -d
```

**G4** — expected: empty output. Calibrated 2026-07-14: empty output.

```bash
rg -n "from ['\"][^'\"]*e2e/" packages
```

**G5** — expected: empty output. Calibrated 2026-07-14: empty output.

```bash
rg -n --glob '*.json' --glob '*.jsonc' --glob '*.toml' '(CLOUDFLARE_API_TOKEN|CF_API_TOKEN).*[A-Za-z0-9_-]{20,}' e2e packages
```

**G6** — expected at change-end: exit 0 with no output. The negative contract
test is excluded because it deliberately names Netlify while asserting absence.

```bash
test ! -e netlify.toml
if rg -n -i 'netlify' package.json packages e2e scripts .github \
  --glob '!scripts/verify/workers-config.test.ts'; then
  echo 'ERROR: active Netlify configuration or command remains' >&2
  exit 1
fi
```

## Risks / Trade-offs

- [Risk] Animus's Vite plugin holds per-instance analysis state while Vinext and
  React Router create multiple Vite environments -> Mitigation: dedicated builds
  and CSS assertions resolve DEF-2; adapt the plugin only with reproduced evidence.
- [Risk] Vinext's active Next 16/React 19 peer graph conflicts with existing React
  18 fixtures -> Mitigation: keep dependencies app-local, lock the resolved graph,
  and verify native Next and TypeScript tiers after installation.
- [Risk] React Router v8's Node engine exceeds the current repository pin ->
  Mitigation: include `.tool-versions`, CI-consumed runtime documentation, engine
  metadata, and `verify:ci` in the dependency-envelope evidence.
- [Risk] Framework-generated deployment configuration is bypassed by a root-level
  Wrangler invocation -> Mitigation: deploy/version scripts execute in the owning
  workspace and dry runs inspect the generated artifact.
- [Risk] Workers Builds may differ from local Bun/workerd behavior -> Mitigation:
  use pinned tooling, the repo root as build context, source-build the V2 binary,
  fail extraction strictly, and require a Git-triggered remote build before the
  ops gate closes.
- [Risk] Four deploy targets increase maintenance -> Mitigation: each target has a
  distinct contract and focused tier; defer overlapping frameworks.
- [Trade-off] Components/design-system fixtures are partially duplicated -> this
  keeps each consumer isolated and makes framework failures attributable.
- [Trade-off] React Router and Vinext canaries expand `verify:full` duration -> the
  focused tiers remain independently runnable, and the full matrix is release-level
  evidence rather than the inner loop.

## Migration Plan

1. Resolve and lock the deployment/framework dependency envelope without changing
   remote state; verify native Next and existing fast tiers remain viable.
2. Add and locally prove the showcase Worker config. Update the existing `animus`
   Workers Build to repository root and app-dispatched commands only after its
   build/assert/dry-run is clean.
3. Upgrade the Vite canary and add Vinext and React Router canaries one at a time,
   running focused build/assert/dry-run evidence after each.
4. Add the new apps to workspace/orchestration/Change-Type Map ownership, run the
   complete local matrix, then remove the nonfunctional Netlify configuration and
   its deploy command. Netlify is not treated as an operational fallback.
5. If Cloudflare authentication is available and the user-authorized account is
   confirmed, create the three new Workers, connect the same Git repository with
   repository-root builds, enable non-production builds, and smoke their URLs.
6. Prove a cold Git-connected Linux build: provision the exact Node/Rust
   toolchains, compile V2 before each app build, require strict extraction, and
   reject any green deployment with empty generated CSS.

Rollback before remote creation is deletion of the new app/config surfaces and
restoration of the prior Netlify files from history by the user (Git mutation is
outside agent authority). After deployment, Cloudflare's prior Worker versions and
build settings provide operational rollback; `animus` must not be switched until
its new version responds successfully. Acceptance requires all repository tiers,
deployment dry runs, guardrails, and any authorized remote HTTP smokes to pass.
