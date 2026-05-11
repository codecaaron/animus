## Context

The CI workflow was created during the `cross-platform-napi` change (session 5) as a first pass. It has three jobs: `check` (TS-only), `build-extract` (Rust matrix), `verify` (full pipeline with binary). The `check` and `verify` jobs duplicate lint, build, and test work. The `check` job also runs `bun test` without the NAPI binary, which would fail for any test that imports extraction functions.

Several bugs were discovered when running CI: `napi` binary not on PATH, root `tsc --noEmit` picks up dead packages (`_docs`, `ui`, `_integration`), and compile runs before build so cross-package imports fail.

There is no release job. The `publishing-surface` change (27 tasks) handles package restructuring and metadata, but assumes CI can actually publish. This change provides the infrastructure.

## Goals / Non-Goals

**Goals:**
- CI that catches real errors without redundant work
- NAPI platform packages published to npm (synthetic packages from `napi pre-publish`)
- TS packages publishable from CI with correct dependency ordering
- Beta versions on `next` branch, stable on `main`
- Manual trigger option for release (workflow_dispatch)

**Non-Goals:**
- Package restructuring (that's `publishing-surface`)
- Changesets or automated version bumping (manual version management for now)
- Monorepo publishing orchestration tools (Lerna, changesets, etc.) — just direct `npm publish`
- CDN distribution or GitHub Releases for binaries

## Decisions

### Decision 1: Collapse to 4 CI jobs

**Choice:** `lint` → `build-extract` → `verify` → `release`

| Job | Runs on | Does what | Depends on |
|-----|---------|-----------|------------|
| `lint` | ubuntu | `bun run check` (biome only) | — |
| `build-extract` | matrix (3 platforms) | Rust NAPI compile, upload artifacts | — |
| `verify` | ubuntu | Download binary, build TS, compile, test, showcase | `build-extract` |
| `release` | ubuntu | Download all binaries, `napi pre-publish`, npm publish all | `verify`, only on tag/dispatch |

**Why:** `check` and `verify` duplicated lint, build, and test. `check` ran tests without the binary (broken). Lint is fast and independent — run it in parallel with `build-extract`. Everything else goes in `verify` which has the real binary.

### Decision 2: Tag-triggered release with manual dispatch

**Choice:** Release job runs on `v*` tag push OR `workflow_dispatch`. No automatic publishing on push.

**Why:** Automatic publish on every push is dangerous for a package ecosystem. Tags are explicit intent. Manual dispatch allows emergency releases. Beta versions use `v0.1.0-next.N` tags on `next` branch.

### Decision 3: Publish order — platform packages first, then TS packages

**Choice:**
1. Publish `@animus-ui/extract-darwin-arm64`, `-linux-x64-gnu`, `-linux-arm64-gnu`
2. Publish `@animus-ui/extract` (depends on platform packages via optionalDependencies)
3. Publish `@animus-ui/core`, `@animus-ui/theming` (no cross-deps)
4. Publish `@animus-ui/runtime` (depends on react peer)
5. Publish `@animus-ui/system` (depends on core, theming)
6. Publish `@animus-ui/vite-plugin` (depends on extract, core)

**Why:** npm resolves optionalDependencies at install time. If platform packages aren't published yet when the main extract package is published, installs will silently skip the binary. TS packages follow dependency order.

### Decision 4: `bunx @napi-rs/cli` instead of bare `napi`

**Choice:** Use `bunx @napi-rs/cli build` in CI instead of `napi build`.

**Why:** `@napi-rs/cli` is a devDependency of `packages/extract`. After `bun install`, the binary is in `node_modules/.bin/` but not on system PATH in CI. `bunx` finds local binaries first.

### Decision 5: Per-workspace compile, not root tsc

**Choice:** `compile` script runs `tsc -p <pkg>/tsconfig.json --noEmit` for each active package.

**Why:** Root `tsc --noEmit` uses root tsconfig (`jsx: "react"`) which doesn't match packages that need `jsx: "react-jsx"`. Each package has its own tsconfig with correct settings. Dead packages (`_docs`, `ui`, `_integration`) are excluded from workspaces entirely.

## Risks / Trade-offs

**[Tag discipline required]** → Publishing requires manual tag creation. Mitigation: document the tag convention (`v0.1.0-next.1` for beta, `v0.1.0` for stable). Consider adding a `release` script that bumps versions and creates tags.

**[Platform package version sync]** → Platform packages must have the same version as the main extract package. Mitigation: `napi pre-publish` reads version from main package.json and applies it to generated platform packages.

**[NPM_TOKEN required]** → CI needs `NPM_TOKEN` secret for publishing. Mitigation: document setup in workflow comments. Use `--provenance` flag if available for supply chain security.

**[First publish bootstrapping]** → Platform packages don't exist on npm yet. First publish of `@animus-ui/extract` will warn about missing optionalDependencies during install until all platform packages are published. Mitigation: publish platform packages first in the release job, wait for npm registry propagation.
