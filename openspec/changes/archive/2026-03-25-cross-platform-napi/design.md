## Context

The extract package (`packages/extract/`) is a Rust crate compiled to a Node.js native addon via NAPI-RS. Currently only builds locally on the developer's darwin-arm64 machine. The CI workflow (`ci.yaml`) runs `bun run build` (TS only) on `ubuntu-latest` — it never touches the Rust crate. The package.json declares 5 NAPI targets but only 1 has ever been compiled.

The auto-generated `index.js` binary loader already handles platform detection and scoped npm package fallback. The `napi pre-publish` tooling is already a devDependency. The infrastructure for cross-platform distribution exists — the CI just doesn't use it.

## Goals / Non-Goals

**Goals:**
- Rust crate builds on all supported platforms in CI
- `bun run verify:full` runs on linux in CI, proving extraction works cross-platform
- NAPI targets trimmed to platforms that matter in 2026
- Foundation for future npm publishing (scoped platform packages)

**Non-Goals:**
- npm publishing — not yet, the package is private
- WASM fallback — adds complexity for a niche use case
- musl builds — glibc covers the CI and Docker environments we care about
- Windows native — WSL2 users get the linux binary

## Decisions

### 1. Three targets, not five

Trim `napi.targets` in package.json to:
- `aarch64-apple-darwin` — dev machines (Apple Silicon)
- `x86_64-unknown-linux-gnu` — CI, Docker, Linux workstations
- `aarch64-unknown-linux-gnu` — ARM CI runners (GitHub Actions arm64), Graviton

Drop `x86_64-apple-darwin` (Intel Mac discontinued 2022, negligible in 2026) and `x86_64-pc-windows-msvc` (frontend devs on Windows use WSL2 → linux-x64-gnu binary).

### 2. GitHub Actions matrix with native runners

Use native runners for each target — no cross-compilation:
- `macos-14` (or `macos-latest`) — Apple Silicon runner, builds `aarch64-apple-darwin`
- `ubuntu-latest` — x86_64, builds `x86_64-unknown-linux-gnu`
- `ubuntu-24.04-arm` — ARM64 runner, builds `aarch64-unknown-linux-gnu`

**Why not cross-compilation?** Cross-compiling Rust with NAPI is possible but finicky (linking against target Node.js headers, platform-specific C libs). Native runners are simpler, more reliable, and GitHub provides ARM runners. Build time is ~2-3 minutes per target, acceptable for CI.

### 3. Separate build and verify jobs

```
build-extract (matrix: 3 platforms)
  → upload .node artifact per platform

verify (needs: build-extract)
  → download linux-x64 artifact
  → bun install + build:ts
  → bun run verify:full (includes showcase build)
```

The build matrix runs in parallel. The verify job runs on `ubuntu-latest` using the linux-x64-gnu binary, proving the full pipeline works end-to-end. The darwin and linux-arm64 binaries are built but not verified in CI (they're the same Rust code, just different targets).

### 4. Rust toolchain via `dtolnay/rust-toolchain`

Standard action for CI Rust builds. Pin to `stable`. Cargo caching via `Swatinem/rust-cache` to avoid recompiling dependencies on every run (~60% build time reduction).

### 5. Binary artifacts uploaded per job, not committed

`.node` binaries stay in `.gitignore`. CI builds upload them as job artifacts. The verify job downloads what it needs. For future npm publishing, a release workflow would download all artifacts and run `napi pre-publish`.

### 6. Keep existing TS-only check job

The current `check` job (lint, typecheck, build:ts, test) stays as-is — it's fast and doesn't need the Rust crate. The new `verify` job is the full-pipeline proof that includes extraction.

## Risks / Trade-offs

**ARM runner availability** → GitHub Actions arm64 runners (`ubuntu-24.04-arm`) are generally available but newer. If availability is unreliable, linux-arm64 can be dropped from CI matrix without blocking the rest. → Mitigation: make arm64 build optional (`continue-on-error: true`) initially.

**CI time increase** → Adds ~3-5 minutes total (Rust builds run in parallel). → Acceptable for a full-pipeline verification.

**Cargo.lock in monorepo** → The lock file is in `packages/extract/`. CI needs to ensure it's used (`--locked` flag) for reproducible builds. → Already committed, just need to pass the flag.

## Open Questions

- **Should linux-arm64 be required or optional in CI?** GitHub ARM runners are GA but if they're flaky, blocking PRs on them is counterproductive. Recommend starting as optional.
- **When to add npm publishing workflow?** Not now — the package is private. When it goes public, add a release job that runs `napi pre-publish -t npm` and publishes scoped platform packages.
