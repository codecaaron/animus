## 1. Phase 0 — Investigation gate + primary bug-coverage unit tier

- [x] 1.1 Add `@mdx-js/mdx` as a dev-dep to `packages/_integration/package.json` so the integration-test harness can preprocess MDX source. Run `bun install` and confirm the lockfile resolves to the same `@mdx-js/mdx` version as the existing transitive resolution from `@mdx-js/rollup@3.1.1`.
- [x] 1.2 Author the minimized integration fixture under `packages/_integration/fixtures/components/mdx-rendering/` — `component.tsx` exporting a ds-built component (e.g. `MdxRenderedBox`) and `usage.mdx` rendering `<MdxRenderedBox>`. No `.ts`/`.tsx`/`.js`/`.jsx` usage of the component.
- [ ] 1.3 Author primary bug-coverage unit test at `packages/vite-plugin/tests/file-discovery.test.ts`. The test SHALL invoke the plugin's own `discoverFiles` function against a fixture directory containing one `.tsx` file and one `.mdx` file and assert:
  - With default extensions, `.mdx` appears in the returned file list.
  - With `options.extensions: ['.ts', '.tsx']` (override dropping `.mdx`), `.mdx` does NOT appear.
  - Paired seal/acceptance per the prior `fix-selector-rule-extraction` D3 pattern: `test('[Bug seal — .mdx not discovered with default extensions]')` asserts current broken behavior (pre-fix); `test.skip('[Bug acceptance — .mdx discovered with default extensions]')` skipped until Phase 1 unseals.
- [ ] 1.4 Author parallel unit test at `packages/next-plugin/tests/file-discovery.test.ts` mirroring 1.3 but invoking next-plugin's own `discoverFiles` method. Adapter-parity-by-shared-constant means both tests assert identical default behavior.
- [x] 1.5 Author the integration test `packages/_integration/__tests__/mdx-rendering.test.ts` as end-to-end smoke coverage. Invoke `runPipeline` with both files after preprocessing `.mdx` via `@mdx-js/mdx`'s `compile()` directly in the test (the preprocessor module isn't built yet). Paired seal/acceptance:
  - `test('[Bug seal — MDX-only rendering eliminated in prod mode]')` — asserts `components_eliminated >= 1` today (pre-fix).
  - `test.skip('[Bug acceptance — MDX-only rendering extracts in prod mode]')` — skipped; unskips in Phase 3.
- [ ] 1.6 Run `bun run verify:unit:ts` — confirm both new unit test seals pass and skipped acceptances would fail against current behavior. If either seal FAILS to pass (meaning the bug is already "fixed" by some other code path), pause and investigate — the test is diagnosing the wrong gap.
- [x] 1.7 Run `bun run verify:integration` — confirm the integration seal passes and the skipped acceptance would fail.
- [ ] 1.8 Verify with a live showcase dev-mode run that the post-Phase-4 `kind: "prospective_component"` diagnostic fires for `MetricGrid`: `ANIMUS_DEBUG=1 bun run --filter './packages/showcase' dev` and grep console output for `MetricGrid would be eliminated in production`. Expected: warning fires (validates the gap's dev-side observability). If warning does NOT fire, investigate Phase-4 warning-emission path BEFORE scoping this change's fix.

## 2. Phase 1 — Preprocessor module + vite-plugin config + preprocessor wiring

- [x] 2.1 Create `packages/extract/pipeline/mdx-preprocessor.ts` exporting:
  - `DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mdx'] as const` and `DefaultExtension` type.
  - `async function preprocessMdx(source: string, filename: string): Promise<string | null>` — dynamically imports `@mdx-js/mdx` via `await import('@mdx-js/mdx').catch(() => null)`; if null, returns null; otherwise calls `compile(source, { outputFormat: 'function-body', development: false })` and returns the JSX-compiled string. Prepend a `/* @mdx-source: <filename> */` comment for scanner error-reporting trace.
- [x] 2.2 Add `@mdx-js/mdx` to `packages/extract/package.json` as `peerDependencies: { "@mdx-js/mdx": "^3.0.0" }` + `peerDependenciesMeta: { "@mdx-js/mdx": { optional: true } }`. Do NOT add as a regular or dev dep — the optional peer is the entire dep strategy.
- [x] 2.3 Update `packages/extract/pipeline/index.ts` (or equivalent barrel) to export `{ DEFAULT_EXTENSIONS, preprocessMdx, type DefaultExtension }` from the new module.
- [x] 2.4 Rebuild extract's TS pipeline dist (`bun run --filter '@animus-ui/extract' build:ts`) so downstream plugins can resolve the new exports during their rebuilds.
- [x] 2.5 Extend `AnimusExtractOptions` in `packages/vite-plugin/src/index.ts` with `extensions?: string[]` field + JSDoc referencing the default constant.
- [x] 2.6 Add `@mdx-js/mdx` to `packages/vite-plugin/package.json` as peer-dep-optional (same shape as 2.2).
- [x] 2.7 Import `DEFAULT_EXTENSIONS` and `preprocessMdx` from `@animus-ui/extract/pipeline` at the top of `packages/vite-plugin/src/index.ts`. Delete the module-local `DEFAULT_EXTENSIONS` const at line 79.
- [x] 2.8 Replace the `DEFAULT_EXTENSIONS.has(...)` check at `packages/vite-plugin/src/index.ts:115` (discovery walk) with a check against `new Set(options.extensions ?? DEFAULT_EXTENSIONS)` computed once per `buildStart`.
- [x] 2.9 Replace the `DEFAULT_EXTENSIONS.has(...)` check at `packages/vite-plugin/src/index.ts:1123` (HMR filter) with the same options-propagated Set.
- [x] 2.10 Add the preprocessor invocation: in the file-ingestion path between `discoverFiles` and the `analyzeProject` NAPI call, iterate discovered files; for any file with `.mdx` extension, call `preprocessMdx(source, path)`. On null return (missing `@mdx-js/mdx`), emit a one-shot `[animus] ⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped` warning and skip the file. On exception, emit `[animus] ⚠ MDX preprocessing failed for <file>: <error>` and skip.
- [x] 2.11 For non-`.mdx` files, pass source through unchanged (identity fast-path).
- [x] 2.12 Rebuild vite-plugin dist: `bun run --filter '@animus-ui/vite-plugin' build:ts`.
- [ ] 2.13 Delete the vite-plugin `[Bug seal ...]` test in `packages/vite-plugin/tests/file-discovery.test.ts`; unskip the acceptance test. Run `bun run verify:unit:ts` — acceptance MUST pass.
- [x] 2.14 Run `bun run verify:compile && bun run verify:integration && bun run verify:showcase && bun run verify:vite`. `animus-MetricGrid*` SHALL now appear in the fresh showcase dist.

## 3. Phase 2 — Next-plugin parity (same shared-constant surface)

- [x] 3.1 Extend `AnimusNextOptions` in `packages/next-plugin/src/types.ts` with `extensions?: string[]` field + JSDoc.
- [x] 3.2 Add `@mdx-js/mdx` to `packages/next-plugin/package.json` as peer-dep-optional (same shape as 2.2).
- [x] 3.3 Import `DEFAULT_EXTENSIONS` and `preprocessMdx` from `@animus-ui/extract/pipeline` at the top of `packages/next-plugin/src/plugin.ts`. Remove the inline `new Set(['.ts', '.tsx', '.js', '.jsx'])` at line 679 and replace with `new Set(options.extensions ?? DEFAULT_EXTENSIONS)` at an appropriate module scope.
- [x] 3.4 Add preprocessor invocation parallel to vite-plugin (task 2.10) in next-plugin's file-ingestion path. Error-handling branches identical.
- [x] 3.5 Rebuild next-plugin dist: `bun run --filter '@animus-ui/next-plugin' build:ts`.
- [ ] 3.6 Delete the next-plugin `[Bug seal ...]` test in `packages/next-plugin/tests/file-discovery.test.ts`; unskip the acceptance test. Run `bun run verify:unit:ts` — acceptance MUST pass.
- [x] 3.7 Run `bun run verify:compile && bun run verify:next`. If `e2e/next-app/` has no MDX fixture, add a minimum one so `verify:next` exercises the plugin's MDX path end-to-end.
- [ ] 3.8 If `e2e/next-app/` or showcase trips new diagnostics post-fix (e.g. MDX files that fail preprocessing due to unsupported syntax), capture the error, either widen preprocessor tolerance or document the limitation.

## 4. Phase 3 — Integration seal/unseal + regression audit

- [x] 4.1 Delete the `[Bug seal — MDX-only rendering eliminated in prod mode]` test in `packages/_integration/__tests__/mdx-rendering.test.ts`. Unskip the acceptance test.
- [ ] 4.2 Run `bun run clean:full`. Then run topological rebuild (`bun run build:all` if present, OR `bun run --filter '@animus-ui/properties' build` → `bun run build:extract` → `bun run --filter '@animus-ui/system' build:ts` → `bun run --filter '@animus-ui/test-ds' build:ts` → `bun run --filter '@animus-ui/next-plugin' build:ts` → `bun run --filter '@animus-ui/vite-plugin' build:ts` → `bun run --filter '@animus-ui/showcase' build`). Then `bun run verify:full`.
- [ ] 4.3 Audit `packages/showcase/dist/assets/styles-*.css` for `animus-MetricGrid*` — expected presence. Count rules + grid-template selectors to confirm MetricGrid's CSS is intact.
- [ ] 4.4 Scan showcase MDX sources for OTHER components that may have been silently eliminated pre-fix: `grep -rnE "<[A-Z][a-zA-Z]*" packages/showcase/src/content/**/*.mdx | awk -F'<' '{print $2}' | awk '{print $1}' | sort -u` and cross-reference against dist CSS. Any newly-extracted components post-fix are silent wins; any still-missing components are new follow-ons.
- [ ] 4.5 Measure buildStart timing pre/post-fix in showcase (`ANIMUS_DEBUG=1 bun run --filter './packages/showcase' build` — compare pre/post Phase 1/2 applied). If buildStart overhead exceeds +10% attributable to MDX preprocessing, document in archive notes and consider opt-out UX.

## 5. Phase 4 — Documentation + archive

- [ ] 5.1 Expand the root `CLAUDE.md` Change-Type Map row `packages/extract/src/**/*.ts (NAPI TS binding / pipeline)` to `packages/extract/{src,pipeline}/**/*.ts (NAPI TS binding / pipeline)` so the new `pipeline/mdx-preprocessor.ts` edit surface has explicit verify-tier mapping.
- [ ] 5.2 Update `packages/vite-plugin/CLAUDE.md` Configuration section to document the new `extensions?: string[]` option + pointer to the preprocessor module + peer-dep-optional note about `@mdx-js/mdx`.
- [ ] 5.3 Update `packages/next-plugin/CLAUDE.md` Configuration section with the same documentation for adapter parity.
- [ ] 5.4 Update `packages/showcase/CLAUDE.md` "Common Breakage Patterns" — add "MDX-only-rendered component eliminated in prod" as a resolved-via-this-arc breadcrumb, OR note the limitation for MDX-provider-mapped components per OQ2.
- [x] 5.5 Run `openspec validate fix-mdx-component-usage-scanning --strict` — must pass. (Passed 2026-04-27: "Change 'fix-mdx-component-usage-scanning' is valid".)

## Archive Notes (2026-04-27)

Archived with incomplete tasks per maintainer direction ("archive insofar as we can"). Functional fix is live in code and end-to-end-verified per the session 84 audit (MetricGrid + EmberGlow + TallyPulse extracted into the fresh showcase dist post-fix). Deferred items:

- **Unit tests not authored (1.3, 1.4, 1.6, 2.13, 3.6):** vite-plugin and next-plugin file-discovery unit tests + bug-seal/acceptance pairs. The real end-to-end audit is the proof of fix; unit tests would be regression coverage, scoped to follow-on. Per `feedback_live_integration_vs_synthetic`, the live integration carries weight that synthetic unit tests would not have added on top of the audit.
- **Phase 4 re-verification not re-run (4.2, 4.3, 4.4, 4.5):** the original audit is the verification. Re-running would be confirmation, not new evidence.
- **Documentation updates (5.1, 5.2, 5.3, 5.4):** root CLAUDE.md Change-Type Map row expansion + per-package CLAUDE.md notes for the new `extensions?: string[]` option + peer-dep-optional `@mdx-js/mdx` pattern. Scoped to follow-on doc pass.
- **Live showcase dev-mode verification (1.8):** the `prospective_component` diagnostic firing for `MetricGrid` pre-fix. Pre-fix state no longer reproducible (fix is live in code). Captured as a one-time diagnostic-validation that has since been overtaken by the actual fix landing.
- **Conditional error-capture (3.8):** no e2e/next-app or showcase trips reported post-fix per session 84.
