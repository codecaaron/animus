# Increment 02: Observed verification paths

## Scope

- **Registry row**: 02 · mode: inline · review: subagent
- **Resolves**: D4, D7, D8, DEF-1
- **Authors**: — (envelope)
- **Depends on**: increment 01 and `change:simplify-verification-graph#03`
- **Inputs from**: none
- **Footprint**: `vite.config.ts`, Vite/Next plugins and tests,
  `packages/_assertions/**`, assertion implementations for Vite, Next,
  showcase, Vinext, and React Router, generic
  `scripts/verify/{build-consumer.sh,assert-consumer.sh}` owner helpers,
  `scripts/verify/{_preconditions.sh,packed.sh}`, new focused verification tests
- **Pushes to a later increment**: cross-target loads remain DEF-4.

> DEF-1 is envelope-licensed: failing adapter tests are the resolving signal
> that chooses shared versus host-specific marker transport.

## Context Capsule

- **Objective**: Make active tests discoverable, make NAPI freshness follow the
  host loader, require served-client CSS, and replace inferred engine receipts
  with a marker written from the module actually loaded during the build.
- **Existing implementation**:
  - `verify:unit:ts` in `vite.config.ts` names six directories and omits
    `packages/system/src/runtime/createClassResolver.test.ts` and
    `packages/extract/tests/discover-packages.test.ts`.
  - `_preconditions.sh` functions `require_fresh_napi_v2` and
    `require_fresh_napi` select `ls ... | head -n1`.
  - `animusExtract` in `packages/vite-plugin/src/index.ts` defines
    `resolvedEngine`, `engineModuleId`, and `requireEngine`.
  - `requireEngine` in `packages/next-plugin/src/singleton.ts` returns the raw
    selected module. V1 uniquely exposes `analyzeProject`; v2 uniquely exposes
    `ExtractEngine`.
  - Lane assertion scripts regex config/plugin source before calling
    `writeLaneReceipt`; `receipt.test.ts` tests JSON serialization only.
  - After `simplify-verification-graph#03`, per-target build/assert wrappers no
    longer exist. Package-owned `verify:build` and `verify:assert` diagnostics
    route through `build-consumer.sh` and `assert-consumer.sh`, which derive the
    owner from package cwd. Engine-marker transport must bind at those generic
    choke points, not recreate per-owner wrapper metadata.
  - Vinext/RR assertion scripts call `findCssFiles` on the whole build root,
    while Wrangler serves `dist/client` and `build/client`.
- **In-scope guardrail**:
  - G3: receipts SHALL NOT infer identity — `rg -n 'Engine facts are MEASURED|config\.match\(|pluginSrc\.match\(' scripts/assert-showcase-build.ts e2e/vite-app/scripts/assert-build.ts e2e/next-app/scripts/assert-build.ts scripts/verify/packed.sh` — STOP.
- **Requirements**: envelope requirements under
  `verification-tier-policy`, `dual-engine-build`,
  `vinext-extraction-canary`, and `react-router-extraction-canary`.
- **Resolved decisions**: D4 actual loaded module writes marker; D7 host target;
  D8 owned-root discovery.
- **North Star**: NS1, NS2, NS4.
- **Prohibitions**: no VCS commands; no source/config contract tests; do not
  edit shared change artifacts; no public API expansion solely for testing.

## Plan

## Task 02.1: Include every active TypeScript test

- [ ] **Step 1 (RED):** Run
  `bunx vp test run packages/system/src/runtime/createClassResolver.test.ts packages/extract/tests/discover-packages.test.ts`
  to prove both files are valid active tests. Then run `vp run verify:unit:ts`
  with test-list reporting and record that they are absent.
- [ ] **Step 2 (GREEN):** Change the unit-tier command in `vite.config.ts` to
  cover the owned system root plus the explicit non-canary extractor test while
  retaining the other package roots. Do not include the native canary twice.
- [ ] **Step 3:** Run `vp run verify:unit:ts`; confirm both previously omitted
  files appear in test output and the tier exits zero.

## Task 02.2: Resolve the exact host-native binary

- [ ] **Step 1 (RED):** Create `scripts/verify/napi-target.test.ts` around a
  pure resolver with cases for darwin-arm64, linux-x64-gnu, linux-arm64-gnu,
  and unsupported platform/arch. Add a temporary freshness fixture where a
  foreign binary is new and the host binary is stale. Run the test; expected:
  FAIL because `napi-target.ts` is absent.
- [ ] **Step 2 (GREEN):** Create `scripts/verify/napi-target.ts` exporting a
  resolver for v1 and v2 filenames from `{platform, arch, libc}` and a CLI that
  prints one absolute or repo-relative expected path. Linux libc detection must
  match the loader's supported GNU targets and fail loud when unknown.
- [ ] **Step 3:** Update `_preconditions.sh` to call the resolver and compare
  inputs only against that exact binary. Preserve existing actionable repair
  messages. Register the new test in the unit tier and run it plus canary
  precondition coverage.

## Task 02.3: Assert the served client CSS root

- [ ] **Step 1 (RED):** Add a `_assertions` unit test that creates valid server
  CSS and an empty client root, then calls a wished-for
  `readRequiredCss(clientRoot, label)` API and expects an `AssertionError`
  naming served-client CSS. Add the positive client CSS case. Run the test and
  observe the missing API failure.
- [ ] **Step 2 (GREEN):** Add the smallest helper under
  `packages/_assertions/src/` that requires at least one non-empty CSS file at
  the supplied root and returns only that root's concatenated CSS. Export it
  through the private assertions package.
- [ ] **Step 3:** Update Vinext to pass `dist/client` and React Router to pass
  `build/client` for every CSS semantic assertion. Keep JS/hydration discovery
  scoped according to its own behavior. Run the helper unit test and the two
  focused assertion tiers when build artifacts are fresh.

## Task 02.4: Emit engine identity from the loaded module

- [ ] **Step 1 (RED):** Add Vite and Next adapter tests using temporary marker
  paths. Inject a fake configured-v1 loader that returns the v2-only
  `ExtractEngine` shape and assert the marker records v2 plus a consistency
  failure. Add missing-marker assertion coverage. Run the tests and observe
  the missing observation API.
- [ ] **Step 2 (GREEN):** Add a private engine-observation helper in each plugin
  or one genuinely shared non-public helper if the tests show identical host
  hooks. It must classify the returned raw module (`ExtractEngine` => v2,
  `analyzeProject` => v1), reject ambiguous shapes, and atomically write
  `{engineLoaded}` to the path provided by the internal
  `ANIMUS_ENGINE_MARKER_PATH` environment variable.
- [ ] **Step 3:** Call the helper immediately after each real `require` returns
  in the Vite `requireEngine` choke point and Next singleton `requireEngine`.
  The marker's value must come from the returned module shape, never
  `resolvedEngine`, `getSharedEngine`, module-id text, or configuration.
- [ ] **Step 4:** Derive one owner-local marker path in
  `build-consumer.sh`, clear it before every owner build, export it as
  `ANIMUS_ENGINE_MARKER_PATH`, and execute the existing package build. Make
  `assert-consumer.sh` derive/export the same path before invoking each
  assertion implementation. Assertion implementations require and consume the
  marker, compare configured expectation with observed identity, and fail on
  mismatch before writing a lane receipt. Add a focused helper test proving
  marker set → clear → build write → assertion consume for multiple package
  owners; do not add an owner-specific marker-path registry.
- [ ] **Step 5:** In `scripts/verify/packed.sh`, allocate distinct staged marker
  paths for the packed Vite and packed Next builds. Clear/export the relevant
  path immediately before each staged build, require both observed markers
  afterwards, compare each configured host expectation with its loaded module,
  and write both observations into `packed.json`. Add missing/stale and
  configured-vs-observed tests for both packed hosts; the packed lane does not
  route through the generic owner helpers.
- [ ] **Step 6:** Delete config/plugin regex inference and delete
  `packages/_assertions/__tests__/receipt.test.ts`. Keep `writeLaneReceipt` as
  an untested trivial serializer or inline it if no longer shared.
- [ ] **Step 7:** Add standing V1 rollback builds for the distinct Vite and Next
  adapters through their package-owned verification claims using the same
  assertions and observed marker. Run focused plugin tests, marker/receipt
  assertions, and available V1/V2 consumer lanes.
- [ ] **Step 8:** Record the marker-transport result as the proposed DEF-1
  signal. The orchestrator will promote it into a new design decision.

## Guardrail gate

- [ ] G3: `rg -n 'Engine facts are MEASURED|config\.match\(|pluginSrc\.match\(' scripts/assert-showcase-build.ts e2e/vite-app/scripts/assert-build.ts e2e/next-app/scripts/assert-build.ts scripts/verify/packed.sh` — result:

## Output contract

- [ ] All RED/GREEN commands and unavailable artifact-dependent checks recorded
- [ ] G3 output recorded
- [ ] Proposed DEF-1 signal entry states the chosen marker transport
- [ ] No workflow/source-string tests added; receipt serializer test removed

## Spec authorship checklist

- [ ] Envelope requirements remain sufficient
- [ ] DEF-1 promoted to a numbered design decision from observed host hooks
- [ ] Journal signal, objections, and reorientation appended
- [ ] Registry row ticked with reorientation timestamp
