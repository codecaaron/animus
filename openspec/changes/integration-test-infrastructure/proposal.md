## Why

The delivery mechanism between "correct CSS in memory" and "correct CSS in browser" has zero automated coverage. The existing 539 tests across 5 tiers validate extraction correctness at the data level (NAPI boundary snapshots, pipeline integration, JS unit, Rust unit, post-build shell grep). But no test verifies that virtual modules resolve, adopted stylesheets apply, or HMR invalidation propagates correctly in a running Vite or Next.js application. A 20-minute code review of the vite-plugin during this investigation surfaced an actual gap (`storedSheets` missing a `compounds` field in dev-mode split delivery). The existing post-build assertions use shell `grep` — they check string presence but not structural correctness (layer ordering, the core cascade contract).

Additionally, the Vite plugin integration path has no contrived test app. `next-test-app` exists as a minimal Next.js fixture with 7 components and post-build shell assertions. No equivalent exists for Vite — the only Vite validation is the full showcase (22 components, MDX, motion, ark-ui), which is a demo app, not a test harness.

## What Changes

- **New top-level `e2e/` workspace directory** — test infrastructure lives outside `packages/`, separating test fixtures from publishable/internal packages
- **Contrived Vite test app** (`e2e/vite-app`) — minimal Vite fixture mirroring `next-test-app` pattern: 7 components importing `@animus-ui/test-ds`, own `ds.ts`, post-build structural assertions
- **Upgraded post-build assertions** — replace shell `grep` with position-aware CSS structure parsing (layer order via `indexOf` comparison, not string containment). Applied to both `e2e/vite-app` and backported to existing `next-test-app` and showcase assertions
- **Plugin self-verification** — `--verify` flag on vite-plugin dev server that runs structural self-checks on startup (virtual module resolution, CSS non-empty, layer order correct)
- **Manifest completeness assertions** — new integration tests in `_integration` package asserting UniverseManifest shape: reciprocal provenance, fragment existence, dynamic_props correctness
- **Shared test helpers** (`e2e/helpers/`) — TestServer interface, CSS structural assertion utilities, port management (Phase 2+)
- **Playwright browser verification** (Phase 2+) — minimal browser test confirming adopted stylesheet delivery
- **HMR lifecycle tests** (Phase 2+) — event-driven file mutation tests for geological reset, fragment invalidation, extension chain cascade

## Capabilities

### New Capabilities
- `vite-test-app`: Contrived minimal Vite application for integration testing — workspace setup, components, build scripts, structural post-build assertions
- `structural-css-assertions`: Position-aware CSS assertion utilities replacing shell grep — layer order validation, class name format checks, placeholder/token guards
- `plugin-self-verify`: Dev server startup self-check flag that validates virtual module resolution, CSS structure, and layer ordering without external test runner
- `manifest-completeness-testing`: Integration-tier assertions on UniverseManifest shape — provenance reciprocity, fragment coverage, dynamic_props correctness, system_prop_map population

### Modified Capabilities
- `showcase-output-assertions`: Upgrade from shell grep to structural CSS assertions
- `next-test-app-assertions`: Upgrade from shell grep to structural CSS assertions
- `pipeline-integration-testing`: Add manifest shape and completeness assertions

## Impact

- **New workspace entries**: `e2e/vite-app` added to root `package.json` workspaces
- **New dependencies**: `@playwright/test` (Phase 2+ only, devDependency in `e2e/`)
- **Existing test commands unchanged**: `bun test`, `bun run test:canary`, `bun run verify` all work as before
- **New test commands**: `bun run test:vite-app` (build + assert), `bun run test:e2e` (Phase 2+)
- **CI additions**: Phase 1 adds `test:vite-app` to `verify:full`. Phase 2+ adds gated Playwright job (PRs to main only)
- **No changes to published packages** — all additions are private test infrastructure
- **Post-build assertion scripts** in showcase and next-test-app replaced with shared structural assertion utilities
- **CI hardening**: bun version pinned in CI workflow, NAPI loading contract documented in `_integration/CLAUDE.md`, binary verification from test context added
- **NAPI loading contract**: formalized requirement that `_integration` tests use direct file path (`require('../../extract/index.js')`), not package resolution — based on bun 1.3.12 `createRequire` regression incident
