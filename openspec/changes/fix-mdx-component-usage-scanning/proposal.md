## Why

MDX files render ds-built components but the extractor's scanner never sees them. `packages/showcase/src/components/docs/MetricCard.tsx:7` exports `MetricGrid`; the only call sites are JSX tags `<MetricGrid>` inside `packages/showcase/src/content/introduction.mdx:15` and `packages/showcase/src/content/support/component-test.mdx:302`. `grep -rn "<MetricGrid>\|createElement(MetricGrid" packages/showcase/src` returns zero hits in any `.ts`/`.tsx`/`.js`/`.jsx` file.

The file-discovery walk in both bundler adapters hardcodes JSX-flavored source extensions only:

- `packages/vite-plugin/src/index.ts:79`: `const DEFAULT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);`
- `packages/next-plugin/src/plugin.ts:679`: `const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);`

Neither walks `.mdx`. The JSX scanner therefore builds a usage ledger with zero renderings for MetricGrid. In production builds (`dev_mode=false`), the reconciler eliminates it — `animus-MetricGrid*` rules are absent from `packages/showcase/dist/assets/styles-*.css` after a fresh `bun run clean:full && bun run verify:build:showcase`. In dev (`dev_mode=true`) the post-`fix-selector-rule-extraction` Position 3 contract retains the component and surfaces a `kind: "prospective_component"` diagnostic — the same dev/build divergence the prior arc was designed to make observable, now revealing a different underlying gap.

This is NOT a JSX scanner gap (scanner correctly handles the JSX it sees), NOT a transform-resolution gap (transforms never run because the component is dropped), NOT a theme-resolution gap. It is a **file-discovery gap**: MDX sources are invisible to the scanner's input set, not mis-handled during parse.

## What Changes

- Extend the scanner's effective input set to include `.mdx` files so JSX usages of ds-built components in MDX source are counted by the usage ledger the same way `.tsx` renderings are. Both `vite-plugin` and `next-plugin` file-discovery paths SHALL cover `.mdx` — asymmetric coverage between adapters is out of scope (either both cover it or neither does; leaving only one covered creates a new adapter-parity gap).
- Scanner SHALL correctly recognize `<Component>` and `<Namespace.Member>` JSX element forms inside MDX (per existing `jsx-system-prop-scanner` contract) once the files reach it. The MDX-specific pre-processing (stripping markdown, extracting JSX regions) happens BEFORE the existing scanner runs; the scanner's own contract is unchanged.
- Add a permanent integration regression fixture capturing: a ds-built component exported from a `.tsx` module, used ONLY from a sibling `.mdx` file, extracted correctly in both dev and build modes (dist-CSS contains the component's rules; manifest shows zero eliminations and zero prospective entries for the component).
- Verify showcase dist contains `animus-MetricGrid*` rules post-fix.
- Document the resolution strategy (pre-processing vs bundler-transform hook vs config-driven extension list) as the primary design decision; the proposal does not pre-commit to an approach.

## Capabilities

### New Capabilities
(none — this change closes an existing gap in file discovery)

### Modified Capabilities
- `jsx-system-prop-scanner`: the scanner's input set SHALL include JSX regions extracted from `.mdx` files. The scanner's element-recognition contract (`<Component>`, `<Namespace.Member>`, `createElement(...)` per the prior arc) is unchanged — it operates on JSX the same way regardless of whether the source file was `.tsx` or `.mdx`.
- `vite-extraction-plugin`: the vite-plugin's file-discovery walk SHALL include `.mdx` files in its scanner input. If a pre-processing step is needed to convert MDX to scanner-consumable form, that step is the plugin's responsibility.

## Impact

**Code affected:**
- `packages/vite-plugin/src/index.ts` — `DEFAULT_EXTENSIONS` set + any MDX pre-processing call site
- `packages/next-plugin/src/plugin.ts` — `extensions` set + parallel MDX pre-processing
- Optional: a shared MDX pre-processor module either in `packages/_assertions` (public-internal shared utility per topology rules) OR inline in each adapter
- `packages/_integration/fixtures/components/mdx-rendering/` — new fixture directory with a `.tsx` component + sibling `.mdx` consumer
- `packages/_integration/__tests__/mdx-rendering.test.ts` — new integration test
- `packages/vite-plugin/CLAUDE.md` and `packages/next-plugin/CLAUDE.md` — note the expanded extension set + pre-processing dependency if applicable

**APIs affected:** none (internal behavioral change; external NAPI signature unchanged).

**Consumers affected:**
- Any consumer rendering ds-built components from `.mdx` files (canonical case: `packages/showcase/src/content/introduction.mdx` renders `MetricGrid`). Previously those components were silently eliminated in production builds; now they extract. Pure bug-fix behavior change — no one was relying on the drop.
- Dev-mode authoring feedback: the prior-arc Phase 4 prospective-elimination warning stops firing for components that ARE rendered from MDX but were being mislabeled as unrendered. Reduces noise in `[animus] ⚠` output.

**Dependencies:** potentially `@mdx-js/mdx` or equivalent for MDX→JSX pre-processing. Showcase already uses `@mdx-js/rollup` at the vite layer — reuse rather than re-introduce a second MDX engine.

**Out of scope (explicit):**
- Scanner semantics changes — scanner still recognizes JSX the way it does today; only its input source set expands.
- Transform evaluation changes — orthogonal subsystem, not touched.
- MDX-specific JSX like MDX-provider-based components — if MDX's `components` mapping (e.g. `h1` → `Heading`) isn't a direct JSX tag reference, it's still invisible. That's a second-order gap tracked as a follow-on; scope here covers only direct `<Component>` tags in MDX.
- Other non-JSX source formats (.vue, .svelte, .astro). Follow-on if/when consumers request.
- Bundler adapters beyond vite and next (none exist today; parity contract kicks in when new ones land).
- Runtime rendering changes — pure static-extractor work.
