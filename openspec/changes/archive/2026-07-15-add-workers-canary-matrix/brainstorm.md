<!--
brainstorm.md — the STRATEGIC exploration record for the whole change.

HISTORICAL RECORD: immutable once design.md exists; design.md supersedes this
file on any conflict.
-->

# Exploration evidence

This capture records the user-approved direction from the 2026-07-14 design
conversation, repository inspection at `e974914`, the failed `animus` Workers
Build, and current primary documentation for Cloudflare Workers, the Cloudflare
Vite plugin, Vinext, and React Router v8. The Superpowers brainstorming skill
was invoked earlier in this session; this file is its schema-directed output.

# Decision chain

1. The existing Cloudflare `animus` build compiles the showcase successfully
   but deploys from `packages/showcase` without a Worker entry point or asset
   directory. The `cp ../../bun.lock` deploy workaround changes package-manager
   metadata but cannot identify deployable output.
2. A single root `wrangler.jsonc` would repair that Worker but would make one
   application the implicit deployment owner. The user requires multiple apps
   in the monorepo to deploy to separate Workers.
3. Therefore each deployable app owns its Worker identity and Wrangler config,
   while repo-root `vp` tasks own dependency-aware builds. A Cloudflare service
   selects its app config explicitly instead of relying on upward config search.
4. Converting `e2e/next-app` to Vinext would delete the only real
   `@animus-ui/next-plugin`/webpack canary. Vinext is additive as
   `e2e/vinext-app`, copied at the behavioral level but built through Vite,
   RSC, and workerd.
5. Static showcase plus static Vite would duplicate hosting coverage. The Vite
   canary should instead add a minimal Worker API and the Cloudflare Vite plugin,
   while the showcase remains the complex assets-only SPA.
6. React Router v8 adds a non-Next full-stack SSR route-module path and exercises
   Cloudflare's `ssr` Vite environment. The user explicitly included it.
7. Astro and TanStack Start add dependency and maintenance surface without a new
   extraction boundary beyond this initial matrix, so they remain deferred.

# Known now

- Preserve `e2e/next-app` and its current verification as the native Next plugin
  oracle; it remains build-only in this change.
- Deploy `packages/showcase` as assets-only Worker `animus`, with SPA fallback
  to `index.html` for deep React Router URLs.
- Upgrade `e2e/vite-app` into Worker `animus-vite-canary`, retaining its existing
  extraction assertions and adding a minimal `/api/*` Worker execution path.
- Add `e2e/vinext-app` as Worker `animus-vinext-canary`, covering App Router RSC,
  a client boundary, and Animus extraction through Vite. It SHALL NOT replace or
  import the native Next fixture.
- Add `e2e/react-router-app` as Worker `animus-react-router-canary`, covering
  React Router v8 SSR and the Cloudflare Vite plugin's `ssr` environment.
- Keep application source/config beside each fixture. Keep shared install/build
  orchestration at the repository root and add new top-level edit surfaces to
  the root Change-Type Map in the same change.
- Remove `netlify.toml` and replace the Netlify-only root deploy script with
  Worker-specific commands that always name an application/config explicitly.
- Use Bun for package management and `vp run` for migrated build/verification
  tiers, consistent with repository policy.
- Build, assert, and Wrangler/Vinext dry-run checks are repository verification;
  live creation/deployment is a separate authenticated action.

# Deferred variables and resolving signals

- **Exact Vinext/React/Cloudflare/React Router package versions.** Resolve when
  the current package registry metadata and peer dependency graph can be read;
  the lockfile produced by `bun install` is the binding signal.
- **Animus plugin ordering/state compatibility with Vinext RSC and React Router
  multi-environment builds.** Resolve with the first production builds. A clean
  extracted stylesheet plus framework output is the signal; a state collision,
  transform drift warning, or missing CSS licenses a focused plugin increment.
- **Whether the Vinext fixture can share all native Next canary components.**
  Resolve by copying the smallest behaviorally equivalent surface and running
  `vinext check`/build. Unsupported hybrid-router or Next-specific constructs
  license reducing the Vinext fixture to App Router while retaining equivalent
  extraction cases.
- **Remote Worker creation and Git-connected Workers Builds for the three new
  services.** Resolve only after local build/assert/dry-run evidence is clean and
  Cloudflare authentication is available. Successful `wrangler whoami` plus a
  user-authorized deploy is the signal.
- **Preview-branch routing and custom domains.** Resolve after each production
  Worker exists and a non-production `versions upload` returns a preview URL.
- **Astro React-island coverage.** Revisit if extraction fails in a consumer that
  embeds React inside non-React source files, or if an Astro consumer is added.
- **TanStack Start coverage.** Revisit if its Cloudflare/Vite integration diverges
  from the React Router SSR environment or a real consumer adopts it.
- **Native Next-on-Workers via OpenNext.** Revisit if production portability of
  `@animus-ui/next-plugin` becomes a release requirement; a passing native Next
  build remains sufficient for this change.

# Candidate north stars

- Every deployed canary proves a distinct framework/runtime boundary, not merely
  that Wrangler can upload another `dist` directory.
- Deployment ownership is local to an app; monorepo dependency orchestration is
  centralized and explicit.
- Existing extraction oracles remain at least as strict as before Workers support.
- The checked-in configuration is sufficient to reproduce a local production
  build and deployment dry run without dashboard-only path knowledge.
- Framework adapters remain thin: canaries exercise Animus packages as consumers
  and do not add production-library dependencies on `e2e/*`.
- Provisional: one Worker per app remains the topology until a measured need for
  service bindings or a multi-Worker application appears.

# Candidate guardrails

- The change SHALL NOT convert or weaken `e2e/next-app`.
  Check: run `vp run verify:next` and review its package dependency on
  `@animus-ui/next-plugin`.
- The change SHALL NOT create a root Wrangler config that ambiguously targets one
  app. Check: `test ! -e wrangler.jsonc` and require explicit config paths in root
  deploy scripts/tasks.
- The change SHALL NOT reuse a Worker name across configs.
  Check: parse all active `wrangler.jsonc` files and assert unique `name` values.
- The change SHALL NOT commit Cloudflare tokens, generated local state, or account
  secrets. Check: secret-pattern `rg` plus ignored `.wrangler/` output.
- The change SHALL NOT introduce `packages/* -> e2e/*` imports.
  Check: repository topology scan and compile verification.
- The change SHALL NOT declare a deployable canary complete on build output alone.
  Check: each app has a framework assertion and a credential-free deployment dry
  run; full-stack fixtures also have a local runtime HTTP smoke check.
- The change SHALL NOT retain Netlify as a competing deployment path.
  Check: `rg -n "netlify"` has no active deployment configuration or script hits.
- The change SHALL NOT silently broaden `verify:full` without adding atomic tasks
  and Change-Type Map ownership for new `e2e/*` surfaces.
  Check: inspect `vite.config.ts`, root `AGENTS.md`, and run the new focused tiers.
