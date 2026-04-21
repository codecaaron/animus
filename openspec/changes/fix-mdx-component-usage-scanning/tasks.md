## 1. Phase 0 — Minimized repro + design gate

- [ ] 1.1 Author a minimum integration fixture under `packages/_integration/fixtures/components/mdx-rendering/` containing: a `component.tsx` exporting a ds-built component (e.g. `MdxRenderedBox`) AND a `usage.mdx` rendering `<MdxRenderedBox>`. No `.tsx`/`.jsx` usage of the component.
- [ ] 1.2 Add a new integration test `packages/_integration/__tests__/mdx-rendering.test.ts` that invokes `runPipeline` with both files AND synthesizes the MDX-pre-processed JSX via `@mdx-js/mdx`'s `compile()` OR by reading a scanner-consumable form the test harness constructs. Paired seal/acceptance tests per the prior `fix-selector-rule-extraction` D3 pattern:
  - `test('[Bug seal — MDX-only rendering eliminated in prod mode]')` — asserts `components_eliminated >= 1` today.
  - `test.skip('[Bug acceptance — MDX-only rendering extracts in prod mode]')` — skipped today; unskips in Phase 2.
- [ ] 1.3 Run `bun run verify:integration` — confirm the seal passes and the skipped acceptance would fail against current behavior.
- [ ] 1.4 Verify with a live showcase dev-mode run that the post-Phase-4 `kind: "prospective_component"` diagnostic fires for MetricGrid: `ANIMUS_DEBUG=1 bun run --filter './packages/showcase' dev` and grep the console output for `MetricGrid would be eliminated in production`. If the warning fires → dev-side diagnostic is working correctly and validates the gap; if not, investigate Phase 4's warning-emission path BEFORE scoping this change's fix.
- [ ] 1.5 Decide D2: preprocessor location (`packages/extract/pipeline/mdx-preprocessor.ts` vs new `packages/_plugin-shared/` workspace). Document decision as ADR addition to design.md.

## 2. Phase 1 — Vite-plugin MDX support

- [ ] 2.1 Create the MDX→JSX pre-processor at the location chosen in task 1.5. It SHALL use `@mdx-js/mdx`'s `compile()` API and return a TypeScript-compatible source string containing the extracted JSX regions, annotated with `/* @mdx-source: <original-path> */` or equivalent so scanner error reporting can reference the original file.
- [ ] 2.2 Add `@mdx-js/mdx` as a direct dep of `packages/vite-plugin/package.json`.
- [ ] 2.3 Extend `packages/vite-plugin/src/index.ts` `DEFAULT_EXTENSIONS` to include `.mdx`.
- [ ] 2.4 In the plugin's file-ingestion path (after `discoverFiles`, before assembling `fileEntries` for `analyzeProject`), call the pre-processor for `.mdx` files. Replace the file's `source` property with the pre-processor output; keep `path` pointing at the original `.mdx` file for diagnostic clarity.
- [ ] 2.5 Handle pre-processor exceptions: catch per-file, emit `[animus] ⚠ MDX preprocessing failed for <file>: <error>` via the plugin's warn fn, exclude the file from the scanner input, continue.
- [ ] 2.6 Run `bun run verify:compile && bun run verify:integration && bun run verify:showcase && bun run verify:vite` — confirm the vite-adapter path extracts MDX-rendered components. `animus-MetricGrid*` SHALL now appear in the fresh showcase dist.

## 3. Phase 2 — Next-plugin MDX support (adapter parity)

- [ ] 3.1 Extend `packages/next-plugin/src/plugin.ts` file-discovery `extensions` Set at `plugin.ts:679` to include `.mdx`. Parallel the vite-plugin's ingestion pattern.
- [ ] 3.2 Add `@mdx-js/mdx` as a direct dep of `packages/next-plugin/package.json` (or consume via the shared preprocessor module per D2).
- [ ] 3.3 Confirm via `bun run verify:compile && bun run verify:next` that next-app builds extract any MDX-rendered components (if next-app has any; if not, add a minimum MDX fixture to `e2e/next-app/` for parity coverage).
- [ ] 3.4 If showcase OR next-app builds now trip new diagnostics (e.g. MDX files that fail preprocessing due to unsupported syntax), capture the error and either widen the preprocessor's tolerance or document the limitation.

## 4. Phase 3 — Seal/unseal + regression audit

- [ ] 4.1 Delete the Bug seal test; unskip the Bug acceptance test in `mdx-rendering.test.ts`.
- [ ] 4.2 Run `bun run clean:full && bun run verify:full` — confirm the whole pipeline is green post-fix.
- [ ] 4.3 Audit `packages/showcase/dist/assets/styles-*.css` for `animus-MetricGrid*` — expected presence. Count rules + `:focus-visible` selectors.
- [ ] 4.4 Scan showcase source for OTHER MDX-only-rendered components that may have been silently eliminated pre-fix: `grep -rnE "<[A-Z][a-zA-Z]*" packages/showcase/src/content/**/*.mdx | awk -F'<' '{print $2}' | awk '{print $1}' | sort -u` and cross-reference against dist CSS. Any newly-extracted components post-fix are silent wins; any still-missing components are new follow-ons.

## 5. Phase 4 — Documentation + archive

- [ ] 5.1 Update `packages/showcase/CLAUDE.md` "Common Breakage Patterns" — add "MDX-only-rendered component eliminated" as a resolved-via-this-arc breadcrumb, OR note the limitation for MDX-provider-mapped components per OQ2.
- [ ] 5.2 Update `packages/vite-plugin/CLAUDE.md` with the extension set (`.mdx` added) and a pointer to the pre-processor module.
- [ ] 5.3 Update `packages/next-plugin/CLAUDE.md` with the same.
- [ ] 5.4 Run `openspec validate fix-mdx-component-usage-scanning --strict` — must pass.
- [ ] 5.5 Archive via `/opsx:archive fix-mdx-component-usage-scanning`.
- [ ] 5.6 Update session memory: the file-discovery gap class (distinct from JSX-scanner and theme-resolution gaps), the adapter-parity requirement, the MDX-provider-subtlety follow-on trail.
