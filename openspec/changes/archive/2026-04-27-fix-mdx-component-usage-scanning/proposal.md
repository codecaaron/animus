## Why

MDX files render ds-built components but the extractor's scanner never sees them. `packages/showcase/src/components/docs/MetricCard.tsx:7` exports `MetricGrid`; the only call sites are JSX tags `<MetricGrid>` inside `packages/showcase/src/content/introduction.mdx:15` and `packages/showcase/src/content/support/component-test.mdx:302`. `grep -rn "<MetricGrid>\|createElement(MetricGrid" packages/showcase/src` returns zero hits in any `.ts`/`.tsx`/`.js`/`.jsx` file.

The file-discovery walk in both bundler adapters hardcodes JSX-flavored source extensions only:

- `packages/vite-plugin/src/index.ts:79`: `const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);`
- `packages/next-plugin/src/plugin.ts:679`: `const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);`

Neither walks `.mdx`. The JSX scanner therefore builds a usage ledger with zero renderings for MetricGrid. In production builds (`dev_mode=false`), the reconciler eliminates it — `animus-MetricGrid*` rules are absent from `packages/showcase/dist/assets/styles-*.css` after a fresh `bun run clean:full && bun run verify:build:showcase`. In dev (`dev_mode=true`) the post-`fix-selector-rule-extraction` Position 3 contract retains the component and surfaces a `kind: "prospective_component"` diagnostic — the same dev/build divergence the prior arc was designed to make observable, now revealing a different underlying gap.

This is NOT a JSX scanner gap (scanner correctly handles the JSX it sees), NOT a transform-resolution gap (transforms never run because the component is dropped), NOT a theme-resolution gap. It is a **file-discovery gap**: MDX sources are invisible to the scanner's input set, not mis-handled during parse.

## What Changes

- Add a `extensions?: string[]` config option to both `AnimusExtractOptions` (vite-plugin) and `AnimusNextOptions` (next-plugin), defaulting to a shared `DEFAULT_EXTENSIONS` constant `['.ts', '.tsx', '.js', '.jsx', '.mdx']` exported from `packages/extract/pipeline/mdx-preprocessor.ts`. Both plugins' existing hardcoded extension Sets (vite-plugin/src/index.ts:79 + :1123 + next-plugin/src/plugin.ts:679) consume `options.extensions ?? DEFAULT_EXTENSIONS`. Adapter parity becomes a structural invariant — the default constant is imported by both plugins.
- Extend the scanner's effective input set to include `.mdx` files by default. JSX usages of ds-built components in MDX source are counted by the usage ledger the same way `.tsx` renderings are.
- Run `.mdx` files through a minimal MDX→JSX preprocessor (`packages/extract/pipeline/mdx-preprocessor.ts` using `@mdx-js/mdx`'s `compile()` API) BEFORE handing them to the existing scanner. Scanner's own contract is unchanged — it operates on JSX the same way regardless of source file type.
- Declare `@mdx-js/mdx` as `peerDependenciesMeta.optional` on both plugins with a range `^3.0.0`. The preprocessor loads it via dynamic import with `.catch()`; non-MDX consumers pay zero install cost. Consumers who have `.mdx` in `extensions` but lack `@mdx-js/mdx` installed see a one-shot buildStart warning and MDX files are skipped.
- Add primary bug-coverage as TS unit tests in `packages/vite-plugin/tests/file-discovery.test.ts` + `packages/next-plugin/tests/file-discovery.test.ts` (paired seal/acceptance) — exercises the hardcoded-extension-list bug directly at the file-walk layer.
- Add a permanent integration regression fixture in `packages/_integration/fixtures/components/mdx-rendering/` capturing: a ds-built component exported from a `.tsx` module, used ONLY from a sibling `.mdx` file, extracted correctly in both dev and build modes (dist-CSS contains the component's rules; manifest shows zero eliminations and zero prospective entries for the component).
- Add `@mdx-js/mdx` dev-dep to `packages/_integration/package.json` so the integration test harness can preprocess MDX.
- Verify showcase dist contains `animus-MetricGrid*` rules post-fix.
- Expand the root `CLAUDE.md` Change-Type Map row from `packages/extract/src/**/*.ts` to `packages/extract/{src,pipeline}/**/*.ts` to cover the new preprocessor edit surface.

## Capabilities

### New Capabilities
(none — this change closes an existing gap in file discovery)

### Modified Capabilities
- `jsx-system-prop-scanner`: the scanner's input set SHALL include JSX regions extracted from `.mdx` files. The scanner's element-recognition contract (`<Component>`, `<Namespace.Member>`, `createElement(...)` per the prior arc) is unchanged — it operates on JSX the same way regardless of whether the source file was `.tsx` or `.mdx`.
- `vite-extraction-plugin`: the vite-plugin's file-discovery walk SHALL respect the consumer-configurable `extensions?: string[]` option, defaulting to a shared `DEFAULT_EXTENSIONS` constant that includes `.mdx`. For `.mdx` files, the plugin SHALL invoke the preprocessor from `@animus-ui/extract/pipeline` before scanner ingestion. `@mdx-js/mdx` SHALL be declared as peer-dep-optional and dynamically imported. The next-plugin SHALL honor the same contract for adapter parity via shared constant import.

## Impact

**Code affected:**
- `packages/extract/pipeline/mdx-preprocessor.ts` — new module exporting `DEFAULT_EXTENSIONS`, `preprocessMdx()`, and types
- `packages/extract/package.json` — add `@mdx-js/mdx` as peer-dep-optional
- `packages/vite-plugin/src/index.ts` — extend `AnimusExtractOptions` with `extensions?: string[]`; replace `DEFAULT_EXTENSIONS` Set (line 79 + line 1123 HMR call-site) with options-propagated equivalent; wire preprocessor for `.mdx` extension
- `packages/vite-plugin/package.json` — declare `@mdx-js/mdx` as peer-dep-optional
- `packages/vite-plugin/tests/file-discovery.test.ts` — new TS unit test, primary bug-coverage tier
- `packages/next-plugin/src/types.ts` — add `extensions?: string[]` to `AnimusNextOptions`
- `packages/next-plugin/src/plugin.ts` — replace inline Set at line 679 with options-propagated equivalent; wire preprocessor for `.mdx` extension
- `packages/next-plugin/package.json` — declare `@mdx-js/mdx` as peer-dep-optional
- `packages/next-plugin/tests/file-discovery.test.ts` — new TS unit test, primary bug-coverage tier
- `packages/_integration/package.json` — add `@mdx-js/mdx` as dev-dep (test-harness needs it)
- `packages/_integration/fixtures/components/mdx-rendering/` — new fixture directory with `component.tsx` + `usage.mdx`
- `packages/_integration/__tests__/mdx-rendering.test.ts` — new integration test (end-to-end smoke; primary bug-coverage is the unit tier above)
- `CLAUDE.md` (root) — Change-Type Map row expansion from `packages/extract/src/**/*.ts` to `packages/extract/{src,pipeline}/**/*.ts`
- `packages/vite-plugin/CLAUDE.md` and `packages/next-plugin/CLAUDE.md` — note the `extensions` option + preprocessor dependency

**APIs affected:**
- `AnimusExtractOptions` (vite-plugin): new optional field `extensions?: string[]`.
- `AnimusNextOptions` (next-plugin): new optional field `extensions?: string[]`.
- New export from `@animus-ui/extract/pipeline`: `DEFAULT_EXTENSIONS`, `preprocessMdx()`, `DefaultExtension` type.
- External NAPI signature unchanged.

**Consumers affected:**
- Any consumer rendering ds-built components from `.mdx` files (canonical case: `packages/showcase/src/content/introduction.mdx` renders `MetricGrid`). Previously those components were silently eliminated in production builds; now they extract by default. Pure bug-fix behavior change — no one was relying on the drop.
- Dev-mode authoring feedback: the prior-arc Phase 4 prospective-elimination warning stops firing for components that ARE rendered from MDX but were being mislabeled as unrendered. Reduces noise in `[animus] ⚠` output.
- Consumers who don't author MDX pay zero install cost (peer-dep-optional gate — dynamic import fires only when `.mdx` is in `options.extensions`).
- Consumers who DO author MDX but don't have `@mdx-js/mdx` installed see a one-shot buildStart warning (`[animus] ⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped`) — install resolves.

**Dependencies:** `@mdx-js/mdx` added to `packages/extract/package.json`, `packages/vite-plugin/package.json`, `packages/next-plugin/package.json` as `peerDependencies` (range `^3.0.0`, matching transitive `@mdx-js/rollup@3.1.1` in lockfile) AND `peerDependenciesMeta: { optional: true }`. Dev-dep on `packages/_integration/package.json` for test-harness use.

**Out of scope (explicit):**
- Scanner semantics changes — scanner still recognizes JSX the way it does today; only its input source set expands.
- Transform evaluation changes — orthogonal subsystem, not touched.
- MDX-specific JSX like MDX-provider-based components — if MDX's `components` mapping (e.g. `h1` → `Heading`) isn't a direct JSX tag reference, it's still invisible. That's a second-order gap tracked as a follow-on; scope here covers only direct `<Component>` tags in MDX.
- Other non-JSX source formats (.vue, .svelte, .astro). Follow-on if/when consumers request.
- Bundler adapters beyond vite and next (none exist today; parity contract kicks in when new ones land).
- Runtime rendering changes — pure static-extractor work.
