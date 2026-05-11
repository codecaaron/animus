## Why

The CI workflow has three bugs (napi command not found, root tsc picking up dead packages, compile running before build) and redundant job structure (check and verify duplicate most work). There is no release pipeline — zero packages can be published from CI. Beta versions haven't been available since the extraction rewrite began. The `publishing-surface` change handles package restructuring but assumes a working CI release pipeline exists.

## What Changes

- Fix CI `napi: command not found` — use `bunx @napi-rs/cli` instead of bare `napi`
- Per-workspace type checking — `compile` runs `tsc -p` on each active package instead of root `tsc --noEmit`
- Build-before-compile ordering in CI and `verify` script
- Workspace exclusions — remove `_docs`, `ui`, `_integration` from workspace array
- Collapse CI jobs — merge redundant `check` + `verify` into `lint` + `build-extract` + `verify`
- Add NAPI release job — download artifacts, `napi pre-publish -t npm`, publish platform packages
- Add TS release job — build and publish core, theming, runtime, system, vite-plugin
- Version strategy: `next` branch → beta tags, `main` branch → stable releases
- Trigger: tag push (`v*`) or manual workflow dispatch

## Capabilities

### New Capabilities
- `ci-workflow-structure`: CI job topology — lint, build-extract matrix, verify (with binary), release. No redundant re-runs.
- `napi-release`: NAPI platform package generation and publishing — synthetic packages from `napi pre-publish`, per-platform npm packages, coordinated publish order.
- `ts-release`: TypeScript package publishing — build order, version resolution, npm publish for core/theming/runtime/system/vite-plugin.

### Modified Capabilities
- `build-verification`: Per-workspace compile, build-before-compile ordering, workspace exclusions for dead packages.

## Impact

- **CI workflow**: `.github/workflows/ci.yaml` restructured from 3 jobs to 4 (lint, build-extract, verify, release)
- **Root package.json**: workspace array explicit (7 packages), `compile` per-workspace, `verify` includes compile
- **System tsconfig**: excludes `__tests__` type test files (separate `test:types` script handles them)
- **No code changes**: purely infrastructure/build system
