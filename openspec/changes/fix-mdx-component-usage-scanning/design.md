## Context

MDX files are first-class consumers of ds-built components in the showcase (and, by extension, in any consumer who adopts MDX for content-heavy surfaces). The file-discovery walk in both bundler adapters (`vite-plugin`, `next-plugin`) is a filesystem scan that selects files by extension — `DEFAULT_EXTENSIONS = {.ts, .tsx, .js, .jsx}` today. MDX sources are outside the set, so their JSX references never reach the scanner.

The plugin lifecycle today:

```
Filesystem walk (DEFAULT_EXTENSIONS) ─────▶ JSX scanner parses source ─────▶ usage ledger ─────▶ reconciler
    (.ts/.tsx/.js/.jsx only)                     (OXC parse)                                     (eliminate unrendered)
```

`.mdx` files go through vite's `@mdx-js/rollup` plugin at transform time — AFTER the extractor's buildStart completes. By the time MDX is JSX-compiled in the bundler, the animus pipeline has already produced its manifest based on a ledger that never saw MDX renderings.

**Confirmed state at this change's proposal time:**

- `packages/showcase/src/components/docs/MetricCard.tsx:7` exports `MetricGrid`.
- 2 files render `<MetricGrid>` — both `.mdx` (`introduction.mdx:15`, `component-test.mdx:302`).
- 0 `.tsx`/`.jsx`/`.js`/`.ts` files render or reference `<MetricGrid>`.
- `packages/showcase/dist/assets/styles-np2ZI_63.css` contains 0 `animus-MetricGrid*` rules after fresh `bun run clean:full && bun run verify:build:showcase`.
- `packages/next-plugin/src/plugin.ts:679` has the identical hardcoded extension set — same bug lives in both adapters.

**What the prior-arc Phase 4 contract reveals here:**

Post-Phase-4, the dev-mode manifest surfaces `kind: "prospective_component"` entries for components that would be eliminated in build mode. Running showcase in dev (or reading the dev-mode manifest) SHOULD show a prospective entry for MetricGrid. That diagnostic is the authoring-time signal that this proposal converts into a proper fix. Without Phase 4's observability, this gap would have stayed silent.

## Goals / Non-Goals

**Goals:**
- `<MetricGrid>` in MDX counted as a valid render usage by the usage ledger — parity with `<MetricGrid>` in `.tsx`.
- Both `vite-plugin` and `next-plugin` discovery walks pick up `.mdx` files.
- Scanner-consumable form (JSX region extracted from MDX) reaches the existing OXC-based parse pipeline unchanged.
- A permanent integration fixture exercises `.tsx`-defined + `.mdx`-rendered.
- Showcase dist contains `animus-MetricGrid*` rules in build mode AND no prospective-elimination warning fires for MetricGrid in dev mode.

**Non-Goals:**
- Scanner semantic changes — JSX element recognition, member-expression recognition, `createElement` recognition all stay the same.
- MDX content-rendering path — the bundler's own MDX plugin still owns the actual runtime rendering; this change only makes the extractor see the authoring references.
- MDX-provider-based component substitution (e.g. `MDXProvider` passing `{ h1: Heading }`) — indirect references through the provider API are NOT direct `<Component>` tags and are scope-expanded if/when they surface as a regression.
- Other source formats (.vue, .svelte, .astro, etc.) — follow-on.
- Code-splitting or on-demand MDX extraction — the scanner processes MDX alongside everything else in buildStart.
- Changing the bundler-pipeline ordering — vite's `@mdx-js/rollup` transform remains as-is; this change operates IN PARALLEL, not in place of.

## Decisions

### D1 — Resolution strategy: plugin-side MDX→JSX pre-processor + consumer-configurable extensions list with sensible defaults

**Decision:** Two paired decisions land together:

1. Each bundler adapter SHALL run non-native-JSX files (today: `.mdx`) through a minimal preprocessor BEFORE handing them to the scanner. The preprocessor strips markdown content and extracts the JSX regions, producing a `.tsx`-equivalent source string that the existing scanner consumes unchanged. Implementation uses `@mdx-js/mdx`'s `compile()` API.
2. The extension list SHALL be exposed as a plugin config option (`extensions?: string[]`) on BOTH `AnimusExtractOptions` (vite-plugin) AND `AnimusNextOptions` (next-plugin). Default is `['.ts', '.tsx', '.js', '.jsx', '.mdx']` — exported as a single `DEFAULT_EXTENSIONS` constant from the shared preprocessor module so both plugins import the same source of truth. Consumers can override (e.g. drop `.mdx` for zero install-footprint, or add `.md` for markdown-JSX variants), but the default IS the fix.

**Alternatives considered:**

- **A) Teach the scanner MDX-aware parsing.** Rejected. OXC parses JSX syntax; MDX is a superset with markdown. Teaching the scanner MDX semantics doubles its surface area and couples it to an unrelated format. Pre-processing keeps the scanner format-agnostic.
- **B) Hook into vite's transform pipeline output.** Rejected for two reasons: (1) violates the adapter-parity goal — next-plugin doesn't use vite's MDX transform, so we'd need two completely different implementations; (2) couples animus's scanner ordering to the bundler's plugin ordering — fragile against plugin reordering by consumers.
- **C) Hardcode `.mdx` into an internal extensions Set — NO config option.** Rejected (this was the prior draft direction; peer-reviewed and flipped). The API surface is literally one optional config field with a sensible default; hardcoding would force a proposal+release for every future `.vue`/`.svelte`/`.astro` request. Configurable-with-default is not premature generalization — it's the natural shape.
- **D) Defer to future bundler-level virtual module magic.** Rejected. Unclear, not grounded in any concrete approach.

**Consequence:** `@mdx-js/mdx` becomes a peer-dep-optional of both plugins (see D5). The preprocessor lives in `packages/extract/pipeline/mdx-preprocessor.ts` (see D2). The `extensions?: string[]` field is added to both plugin options interfaces; both plugins replace their current hardcoded extension Set with `new Set(options.extensions ?? DEFAULT_EXTENSIONS)`.

### D2 — Shared code location: `packages/extract/pipeline/mdx-preprocessor.ts`

**Decision:** Land in `packages/extract/pipeline/`. The candidate `packages/_plugin-shared/` workspace is rejected.

**Evidence flipping the earlier open-two-candidates framing:** the "pipeline is post-NAPI only" framing in the prior design draft was factually wrong. `packages/extract/pipeline/discover-packages.ts` is explicitly pre-NAPI (file-graph work executed before `analyzeProject` runs). The pipeline surface already hosts mixed pre-NAPI and post-NAPI helpers: `applyUnitFallback`, `assembleStylesheet`, `extractSystemFilePackages`, `stripLeadingLayerDeclaration`, `validateLayerOrder`, `resolveTransformPlaceholders`, `resolve-global-styles`, `discover-packages`. Adding `mdx-preprocessor.ts` is consistent with the existing surface, not an expansion of it.

**Alternatives considered:**

- **`packages/_plugin-shared/` (new workspace).** Rejected. A single-helper private workspace fails the `_assertions`/`_integration` bar (those have ≥4 modules AND serve ≥2 consumer tiers). One module is not enough to justify a workspace; the root `package.json` workspaces-array entry, the CI install-cycle addition, and the new `workspace:*` edges for both plugins are all cost with no compensating structural benefit.
- **Inline copies per plugin.** Rejected. Guaranteed drift, doubles surface area, and breaks the shared `DEFAULT_EXTENSIONS` constant invariant from D1.
- **NPM dep on `@mdx-js/mdx` in each plugin directly + duplicate compile-to-JSX logic.** Rejected — the "compile-to-JSX" logic is identical; extracting it as a single helper is trivial.

**Consequence:** The preprocessor module is added to `packages/extract/pipeline/mdx-preprocessor.ts` and exported via the existing `@animus-ui/extract/pipeline` entry. Both plugins consume it via their existing `@animus-ui/extract` workspace dep — zero new edges in the dep graph. The shared `DEFAULT_EXTENSIONS` constant (see D1) lives in the same module. Root `CLAUDE.md` Change-Type Map row `packages/extract/src/**/*.ts (NAPI TS binding / pipeline)` expands to `packages/extract/{src,pipeline}/**/*.ts` to cover the new edit surface (task captured in Phase 4).

### D3 — Spec delta scope

**Decision:** Add scenarios to BOTH `jsx-system-prop-scanner` (the input-set contract) AND `vite-extraction-plugin` (the file-discovery contract). The next-plugin-side parity requirement is captured by extending these two contracts because next-plugin currently has no dedicated spec for its file discovery (the scanner spec covers the semantic contract; the plugin-level file walk is an implementation detail).

**Alternatives considered:**

- **Single spec delta in `jsx-system-prop-scanner` only.** Rejected. The input-set expansion is a file-discovery concern, not a scanner-semantics concern — the scanner's contract is unchanged for what JSX it recognizes.
- **Create a new capability `mdx-file-discovery`.** Rejected. A capability-per-file-type would fragment specs against file-format axes. Extension set lives more naturally as a modifier on the existing file-discovery contract.

### D4 — Diagnostic on MDX pre-processing failure

**Decision:** If the MDX pre-processor throws on a specific file, the plugin SHALL emit an `[animus] ⚠ MDX preprocessing failed for <file>: <error>` warning and continue the build with that file excluded from the scanner's input. Same prefix as existing elimination warnings for grep-filterability.

**Alternatives considered:**

- **Fail hard on MDX preprocessing error.** Rejected. A single malformed MDX file shouldn't break the entire build's extraction — consistent with the prior-arc "warn + continue" diagnostic pattern.
- **Silent skip.** Rejected. Silent failures are the bug class this entire extractor stack explicitly fights against (see Phase 4 dev/build parity).

### D5 — `@mdx-js/mdx` as peer-dep-optional, gated by dynamic import

**Decision:** Both `@animus-ui/vite-plugin` and `@animus-ui/next-plugin` declare `@mdx-js/mdx` in `peerDependencies` (range `^3.0.0` to match `@mdx-js/rollup@3.1.1` already transitive via showcase) AND in `peerDependenciesMeta: { "@mdx-js/mdx": { optional: true } }`. The preprocessor module in `packages/extract/pipeline/` loads it via `await import('@mdx-js/mdx').catch(() => null)`; if the module is absent AND a consumer has `.mdx` in their `extensions`, the plugin emits a one-shot warning at buildStart (`[animus] ⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped`) and continues. If `.mdx` is NOT in `extensions`, the dynamic import never fires.

**Alternatives considered:**

- **Hard direct dep on both plugins.** Rejected. Consumers who don't author MDX would carry `@mdx-js/mdx` + ~15 transitive deps (`unified`, `remark-*`, `mdast-*`, `micromark`, `vfile`) for zero runtime benefit.
- **Peer-dep-required (non-optional).** Rejected. Forces every consumer to install `@mdx-js/mdx` even if they never author MDX — same footprint problem, now with a harder install-time error instead of a graceful skip.
- **Lazy-load only on file discovery.** Same as chosen decision — this IS what dynamic-import-with-catch achieves.

**Consequence:** Non-MDX consumers pay zero install cost. MDX consumers who already use `@mdx-js/rollup` or `@next/mdx` get `@mdx-js/mdx` hoisted for free (lockfile confirms transitive availability in showcase today). The `peerDependenciesMeta.optional` flag is supported by npm/yarn/pnpm/bun uniformly.

### D6 — Shared `DEFAULT_EXTENSIONS` constant exported from the preprocessor module

**Decision:** `packages/extract/pipeline/mdx-preprocessor.ts` exports:

```ts
export const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mdx'] as const;
export type DefaultExtension = (typeof DEFAULT_EXTENSIONS)[number];
export async function preprocessMdx(source: string, filename: string): Promise<string | null>;
```

Both plugins import `DEFAULT_EXTENSIONS` directly and apply it as the fallback for `options.extensions`. Adapter parity becomes a structural invariant — if one plugin drifts (e.g. adds `.astro` locally), it fails either the shared-type contract or the config-option signature check. This closes the "CI enforceable invariant" gap flagged in reviewer synthesis.

**Alternatives considered:**

- **Each plugin keeps its own `DEFAULT_EXTENSIONS` Set.** Rejected — drift-by-default. Prior state already has 3 separate hardcoded copies (vite-plugin index.ts:79 + :1123 + next-plugin plugin.ts:679) — this change consolidates.
- **Re-export from a different module (e.g. `packages/extract/pipeline/index.ts`).** Acceptable but less cohesive. Colocating with the preprocessor makes the dep graph obvious: anyone touching the extension list sees the preprocessor alongside and remembers that `.mdx` needs preprocessing.

**Consequence:** Both plugins `import { DEFAULT_EXTENSIONS, preprocessMdx } from '@animus-ui/extract/pipeline'`. The two current DEFAULT_EXTENSIONS call-sites in vite-plugin (index.ts:115 discovery walk + index.ts:1123 HMR filter) consume `options.extensions ?? DEFAULT_EXTENSIONS` (converted to Set). Same pattern in next-plugin at plugin.ts:679.

### D7 — Primary bug-coverage tier: TS unit tests in plugin packages, not the integration harness

**Decision:** The primary test tier for the hardcoded-extension-list bug is a new `packages/vite-plugin/tests/file-discovery.test.ts` + `packages/next-plugin/tests/file-discovery.test.ts` pair. Each test invokes the plugin's `discoverFiles` function against a fixture directory containing `.mdx` files and asserts that `.mdx` files appear in the returned list (after config-propagated `options.extensions ?? DEFAULT_EXTENSIONS` flows through). The `_integration` fixture remains as an end-to-end smoke proof that an MDX-only-rendered component actually reaches the dist CSS, but it is NOT the primary bug-surface coverage.

**Rationale:** The bug lives at the file-walk layer — hardcoded `DEFAULT_EXTENSIONS` in each plugin. A test that hand-synthesizes preprocessor output and hands it to `runPipeline` never exercises the file-walk. Only a test that drives the plugin's own discovery function against a real directory tree can regression-guard against the hardcode being reintroduced. Six months from now, if someone "simplifies" the plugin and inlines the extensions Set again, the unit tier fails; the integration tier wouldn't notice.

**Alternatives considered:**

- **Integration test only (prior draft).** Rejected per reviewer feedback — tests the preprocessor in isolation, not the discovery walk.
- **Rust-side unit test.** Rejected — the discovery walk is TypeScript plugin code, not Rust.
- **E2e-only (next-app / vite-app builds).** Too slow for inner-loop; appropriate as a secondary guard but not primary.

**Consequence:** Phase 0 includes authoring both unit tests (as paired seal/acceptance per the established D3 pattern from fix-selector-rule-extraction). Each plugin package gains a `tests/` directory if absent. The `verify:unit:ts` tier now covers the file-discovery contract.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `@mdx-js/mdx`'s `compile()` output format differs between versions and breaks our pre-processor's JSX extraction | Peer-dep range `^3.0.0` (matching transitive `@mdx-js/rollup@3.1.1` already in showcase lockfile); verify compatibility in CI; surface version on pre-processing-error warning text. |
| MDX files contain JSX that relies on MDX-provider-supplied components (e.g. `<h1>` mapped to `Heading` via `<MDXProvider components={{ h1: Heading }}>`) — scanner sees `<h1>` but not the rendered mapping | Explicitly out of scope per proposal. Document the limitation in `jsx-system-prop-scanner` CLAUDE notes. If this becomes a user-visible gap (e.g. `Heading` silently eliminated despite MDX usage), scope a follow-on. |
| Consumer drops `.mdx` from `extensions` but still has `.mdx` files rendering ds components — silent regression | The preprocessor's dynamic import is gated on presence of `.mdx` in `options.extensions`. If consumer drops it, MDX files are correctly not walked; behavior is deterministic-by-config, not silent. Document in plugin README that MDX rendering requires `.mdx` in the extensions list. |
| Consumer adds unknown extension (e.g. `.vue`) via config but no preprocessor handles it | Current scope: only `.mdx` has a preprocessor. Non-`.mdx` files in `extensions` go direct-to-scanner as if they were JSX — which will fail parse for `.vue`/`.svelte`/`.astro`. Document that consumer-added non-JSX extensions are consumer-responsible until a preprocessor registry lands (deferred follow-on). |
| Primary bug-coverage test tier mismatch (integration test covers the preprocessor but not the discovery walk — reviewer B5) | D7 addresses: primary tier is TS unit tests at `packages/vite-plugin/tests/file-discovery.test.ts` + next-plugin sibling. Integration tier remains as end-to-end smoke. |
| Pre-processor extracts JSX regions but loses source-position fidelity for JSX scanner's error reporting | Source maps from `@mdx-js/mdx`'s `compile()` should suffice. Validate in Phase 1 that scanner error reporting still produces usable file:line on an MDX syntax error. |
| Rebuild-step omission between source edits and downstream `verify:*` tiers causes fail-loud failures (reviewer B8) | Tasks.md Phase 1/2 explicitly interleave `bun run --filter '@animus-ui/<plugin>' build:ts` before any `verify:showcase`/`verify:vite`/`verify:next`. Same for `_integration` dep on `@mdx-js/mdx` (reviewer B7+T4) — captured as task. |
| `verify:build:next` CI run requires next-plugin's MDX handling to work with next's own MDX infrastructure — adapter-level tests may uncover interactions | Run `verify:build:next` after next-plugin changes, paralleling the existing prior-arc Phase 4 validation approach. |

## Migration Plan

Behavioral-only change for consumers; new peer-dep-optional on `@mdx-js/mdx` for both plugin packages. Deploy per phase:

1. **Phase 0** — Investigation gate. Author the minimized integration fixture (ds-built component rendered only from MDX) + primary bug-coverage TS unit tests in `packages/vite-plugin/tests/file-discovery.test.ts` + `packages/next-plugin/tests/file-discovery.test.ts` (paired seal/acceptance per D7). Confirm the regression reproduces in both tiers. Confirm the post-Phase-4 `prospective_component` diagnostic fires for MetricGrid in dev. Add `@mdx-js/mdx` dev-dep to `packages/_integration/package.json`. No runtime behavior change yet — seals pass, acceptances skip.
2. **Phase 1** — Author the preprocessor + shared `DEFAULT_EXTENSIONS` constant in `packages/extract/pipeline/mdx-preprocessor.ts`. Add `extensions?: string[]` to `AnimusExtractOptions`. Replace both vite-plugin DEFAULT_EXTENSIONS call-sites (index.ts:79 discovery + index.ts:1123 HMR) with `new Set(options.extensions ?? DEFAULT_EXTENSIONS)`. Wire preprocessor invocation for `.mdx` files. Declare `@mdx-js/mdx` as peer-dep-optional. Rebuild vite-plugin dist. Verify showcase + vite-app builds extract the MDX-rendered component. Delete vite-plugin seal; unskip vite-plugin acceptance.
3. **Phase 2** — Add `extensions?: string[]` to `AnimusNextOptions`. Replace next-plugin plugin.ts:679 inline Set with options-propagated equivalent. Wire preprocessor invocation parallel to vite-plugin. Declare peer-dep-optional. Rebuild next-plugin dist. Verify next-app builds extract MDX-rendered components. Delete next-plugin seal; unskip next-plugin acceptance.
4. **Phase 3** — Seal/unseal integration fixture. Run `bun run clean:full && bun run build:all && bun run verify:full`. Audit `packages/showcase/dist/assets/styles-*.css` for `animus-MetricGrid*` rules (expected present post-fix). Scan for other MDX-only-rendered components that silently eliminated pre-fix.
5. **Phase 4** — Documentation (plugin CLAUDE.md updates) + root CLAUDE.md Change-Type Map row expansion (`packages/extract/{src,pipeline}/**/*.ts`) + session memory update + archive.

Each phase is an isolated commit; revert per-phase if post-land issues surface.

## Open Questions

**OQ1 — RESOLVED (D2):** `packages/extract/pipeline/mdx-preprocessor.ts`. Topology review surfaced that `packages/extract/pipeline/discover-packages.ts` is pre-NAPI, invalidating the "pipeline is post-NAPI only" framing from the prior draft. `_plugin-shared/` workspace rejected on single-helper bloat.

**OQ2 — MDX-provider-mapped components (e.g. `<h1>` → Heading via MDXProvider) — in scope or deferred?** Default: deferred (per proposal non-goals). Flag for scope re-evaluation if showcase or next-app reveal any OTHER component that's eliminated due to this subtler gap after THIS change lands.

**OQ3 — Does next-plugin's MDX support (if any) differ semantically from vite's?** Next has its own MDX story (`@next/mdx`). The extractor's pre-processor is bundler-agnostic (just takes MDX source, returns JSX), but the ways MDX references flow at runtime may differ. Confirm via a minimum next-app MDX fixture in Phase 2.

**OQ4 — RESOLVED (D1):** The extension set IS a plugin config option. User peer-override of the prior-draft's "hardcoded + configurable-deferred" framing — the API surface is one optional config field with a default that includes `.mdx`; hardcoding would force a proposal per future `.vue`/`.svelte`/`.astro` request.

**OQ5 — Does adding MDX to discovery increase buildStart latency noticeably?** Measure pre/post in showcase + next-app during Phase 3. Data informs whether the default-on decision for `.mdx` needs revisiting. If overhead is non-trivial, consumers can opt-out via `extensions: ['.ts', '.tsx', '.js', '.jsx']`.

**OQ6 — Does the same gap affect `.md` files that contain JSX through remark-jsx-style extensions?** Default: out of scope, `.mdx` only. Consumers can add `.md` via `options.extensions: ['.ts', '.tsx', '.js', '.jsx', '.mdx', '.md']` — but without a registered preprocessor for `.md`, the file goes direct-to-OXC and will fail parse. Preprocessor-registry-per-extension is a deferred follow-on.
