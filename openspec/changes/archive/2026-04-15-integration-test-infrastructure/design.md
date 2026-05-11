## Context

The Animus test pyramid has 5 tiers (Rust unit, canary, integration, JS unit, post-build assertions) totaling 539 tests. These validate extraction correctness at the data level — CSS strings produced by the NAPI boundary match expected snapshots. What's missing is validation of the *delivery* mechanism: virtual module resolution, adopted stylesheet application, HMR invalidation propagation, and structural CSS ordering in built output.

The existing post-build assertions (`assert-showcase.sh`, `assert-next-build.sh`) use shell `grep` — string presence checks that cannot validate positional properties like `@layer` ordering, which is the core cascade contract.

A contrived Vite test app (`next-test-app` equivalent) does not exist. The showcase (22 components, MDX, motion, ark-ui) is too heavy for a test fixture.

The project is solo-maintained, pre-v1, greenfield. Test infrastructure must be lightweight, low-maintenance, and earn its keep.

## Goals / Non-Goals

**Goals:**
- Validate CSS structural correctness (layer ordering, not just layer presence) in built output
- Create a contrived Vite test app mirroring the `next-test-app` pattern
- Add manifest shape assertions to catch provenance/fragment/dynamic_props regressions
- Establish `e2e/` workspace topology for future browser and HMR tests
- Plugin self-verification at dev server startup (fail-fast on misconfiguration)
- Harden NAPI loading contract and CI reliability for all NAPI-dependent test tiers

**Non-Goals:**
- Visual fidelity regression (VFR) screenshots — no users to regress against yet
- Cross-plugin parity testing (Vite vs Next) — Next plugin still in flux
- Generated fixtures from source of truth — premature until API stabilizes
- HMR lifecycle tests in Phase 1 — deferred to Phase 2 with event-driven mechanics
- Playwright browser testing in Phase 1 — deferred to Phase 2

## Decisions

### 1. Top-level `e2e/` directory, not `packages/`

Test fixtures and shared test helpers live in a new `e2e/` top-level directory, added to the root `package.json` workspaces list.

**Rationale:** `packages/` is the published/internal package space. Test fixtures are neither. VE uses `fixtures/` + `test-helpers/`, Panda uses `sandbox/`. A dedicated `e2e/` directory cleanly separates test infrastructure from the package graph. Existing precedent (`_integration`, `next-test-app`, `test-ds` in `packages/`) is acknowledged as prior debt, not a pattern to extend.

**Alternative considered:** Keeping fixtures in `packages/_e2e`. Rejected because it continues conflating test infrastructure with packages. The explicit workspace list supports entries outside `packages/` — no tooling constraints.

### 2. Contrived Vite app mirroring `next-test-app`, not showcase

The Vite test fixture is a minimal app with 7 components importing from `@animus-ui/test-ds`, its own `src/ds.ts`, and `vite.config.ts` with `animusExtract()`. Builds in seconds.

**Rationale:** The showcase has MDX, motion, ark-ui, lucide icons, react-router-dom, 22 components, and a complex vite config. It's a demo, not a test harness. A contrived fixture is:
- Fast (seconds to build vs. 10+ seconds for showcase)
- Stable (no external dependency churn from ark-ui/motion updates)
- Targeted (tests extraction pipeline, not application patterns)
- Symmetrical with `next-test-app` (same component set, same assertions, different plugin)

**Alternative considered:** Using showcase as the fixture. Rejected per adversarial review — showcase dependencies add maintenance burden and build time unrelated to extraction correctness.

### 3. Positional CSS assertions, not cssnano normalization

CSS structural correctness is validated via `indexOf` position comparison, not content normalization.

**Rationale:** The cascade contract is positional — `@layer` declaration must precede variables, variables must precede globals, globals must precede component CSS. cssnano normalizes content (whitespace, redundant rules) but masks positional bugs. The actively-confirmed Lightning CSS cascade issue (`fix-lightningcss-cascade` openspec) would pass cssnano-normalized snapshots because the CSS properties are present — just in the wrong position.

The assertion pattern (already used in `post-process.test.ts`):
```typescript
function assertLayerOrder(css: string) {
  const positions = {
    declaration: css.indexOf('@layer'),
    variables: css.indexOf(':root'),
    global: css.indexOf('@layer anm-global {'),
    base: css.indexOf('@layer anm-base {'),
    variants: css.indexOf('@layer anm-variants {'),
  };
  // Assert every position found and in correct order
  for (const [a, b] of pairs(Object.entries(positions))) {
    expect(a[1]).toBeLessThan(b[1]);
  }
}
```

**Alternative considered:** cssnano + prettier normalization (VE's approach). Rejected because it hides the most important bug class for this system.

### 4. Manifest assertions in `_integration`, not `e2e/`

Manifest shape and completeness assertions are added to the existing `packages/_integration` package, not the new `e2e/` workspace.

**Rationale:** Manifest assertions don't need a browser, a dev server, or a fixture app. They test the NAPI boundary output shape — the same level as existing integration tests. Adding them to `_integration` keeps the test tiers clean: `_integration` tests the pipeline at the JS level, `e2e/` tests the delivery mechanism at the build/browser level.

### 5. Phased delivery (Phase 1 now, Phase 2+ earned)

**Phase 1 (this change):**
- `e2e/vite-app` fixture + structural post-build assertions
- Manifest completeness assertions in `_integration`
- Plugin `--verify` self-check flag
- Upgrade existing shell grep assertions to structural CSS assertions

**Phase 2 (future change, after Phase 1 validates):**
- `e2e/helpers/` shared test infrastructure (TestServer interface, port management)
- Playwright browser test: adopted stylesheet verification
- HMR lifecycle tests (event-driven via WebSocket interception, not polling)
- Gated CI job (PRs to main only)

**Phase 3 (future, after v1.0 or first users):**
- VFR screenshot comparison
- Cross-plugin parity (Vite vs Next same CSS)
- Additional fixtures (path aliases, error recovery, plugin ordering)

**Rationale:** Per adversarial review — "You are writing tests for bugs that have not been reported by people who do not exist yet." Phase 1 is cheap insurance (one fixture, structural assertions, manifest checks). Phases 2-3 are earned by demonstrating that Phase 1's pattern works and that there's a concrete need.

### 6. NAPI loading contract and CI reliability

A prior CI incident (session 69, bun 1.3.12) proved that NAPI binary loading via package resolution (`createRequire` + `require('@animus-ui/extract')`) is fragile — bun's `createRequire` polyfill matched the `"types"` export condition, loading `index.d.ts` instead of `index.js`. All NAPI functions became `undefined`. The fix: direct file path (`require('../../extract/index.js')`).

This contract is already in place for the 3 existing `_integration` test files. This change formalizes and protects it:

1. **NAPI loading contract**: All `_integration` tests MUST load the NAPI binary via direct file path, not package resolution. Documented in `_integration/CLAUDE.md`.
2. **Bun version pinning**: `oven-sh/setup-bun@v2` currently installs latest bun. Pin to a known-good version so CI behavior doesn't change without a code change.
3. **CI binary verification from test context**: The existing CI verification step resolves from repo root (`./packages/extract/index.js`). Add a step that verifies from the actual `_integration` test file context to match real resolution paths.

**Rationale:** Adding more NAPI-dependent tests (manifest-shape.test.ts in Task 6) amplifies the fragility if the loading contract isn't formalized. The incident proved that tests that pass locally can fail silently on CI due to bun version drift. This is the infrastructure reliability foundation that all NAPI-dependent tests depend on.

**Alternative considered:** Switching `_integration` to vitest (Node.js module resolution instead of bun polyfill). Deferred — the direct path workaround is sufficient and avoids introducing a second test runner. Revisit if bun's `createRequire` regresses again.

### 7. Self-verification flag on dev server

The vite-plugin gains a `verify` option (default: false) that runs structural self-checks during `buildStart`:
- Virtual module IDs resolve correctly
- `resolvedComponentCss` is non-empty (at least one component extracted)
- Layer ordering in assembled CSS is structurally correct
- `variableCss` contains `:root` block
- No `__TRANSFORM__` placeholders in any CSS output

Logged as `[animus:verify]` prefixed messages. Errors throw in strict mode, warn otherwise.

**Rationale:** 20 lines of code in the plugin, zero dependencies, catches misconfiguration at the integration point without needing external test infrastructure. Complements the build-time assertions with runtime-time verification.

## Risks / Trade-offs

**[Fixture maintenance when API evolves]** → Phase 1 fixture is 7 components importing from `test-ds` which is already maintained. The fixture's own `ds.ts` is the only file that needs updating when the system API changes. If this proves burdensome, Phase 3 considers generated fixtures.

**[Structural assertions are verbose]** → `indexOf` comparisons are more code than `grep`. Mitigated by extracting shared assertion utilities (`assertLayerOrder`, `assertNoPlaceholders`, `assertClassNameFormat`) into `e2e/helpers/assert-css.ts`, reusable by both vite-app and next-test-app assertions.

**[`storedSheets` compounds gap]** → The QA review identified that `storedSheets` (dev-mode CSS split) has no `compounds` field. This is either a real bug (compound CSS lost in dev) or by design (compounds folded into another layer). Must be investigated during Phase 1 implementation, independent of the test infrastructure.

**[Rust cache isolation]** → `clearAnalysisCache()` is process-global. Phase 2 HMR tests running sequentially in the same process risk cross-contamination. Mitigation: TestServer constructor calls `clearAnalysisCache()` before `buildStart`. Explicit test for isolation.

**[NAPI loading path fragility]** → bun's `createRequire` polyfill has diverged from Node.js semantics before (session 69, bun 1.3.12). The direct path workaround (`require('../../extract/index.js')`) is resilient but must be documented and enforced as convention. New test files that use `require('@animus-ui/extract')` would silently reintroduce the vulnerability. Mitigated by: documenting the contract in `_integration/CLAUDE.md`, pinning bun version in CI, and adding context-aware binary verification.
