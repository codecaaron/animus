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

### D1 — Resolution strategy: plugin-side MDX→JSX pre-processor before the scanner

**Decision:** Each bundler adapter SHALL run MDX files through a minimal MDX-to-JSX pre-processor BEFORE handing them to the scanner. The pre-processor strips markdown content and extracts the JSX regions, producing a `.tsx`-equivalent source string that the existing scanner consumes unchanged. Implementation uses `@mdx-js/mdx`'s `compile()` API (already a transitive dep via `@mdx-js/rollup` in showcase, but we'd pin a direct dep to avoid the coupling).

**Alternatives considered:**

- **A) Teach the scanner MDX-aware parsing.** Rejected. OXC parses JSX syntax; MDX is a superset with markdown. Teaching the scanner MDX semantics doubles its surface area and couples it to an unrelated format. Pre-processing keeps the scanner format-agnostic.
- **B) Hook into vite's transform pipeline output.** Rejected for two reasons: (1) violates the adapter-parity goal — next-plugin doesn't use vite's MDX transform, so we'd need two completely different implementations; (2) couples animus's scanner ordering to the bundler's plugin ordering — fragile against plugin reordering by consumers.
- **C) Consumer-configurable extension list + bring-your-own pre-processor.** Deferred. Could be the Phase 4+ extensibility path after the default case lands. For now: the default case IS MDX, and building a plugin abstraction before we have a second non-MDX format is premature generalization.
- **D) Defer to future bundler-level virtual module magic.** Rejected. Unclear, not grounded in any concrete approach.

**Consequence:** `@mdx-js/mdx` becomes a direct dep of `vite-plugin` (and next-plugin). The pre-processor is a shared module (candidates: a new `packages/extract/src/mdx_preprocessor.ts` in the extract TS surface, OR a plugin-level `packages/_shared-plugin-utils` package). Phase 0 locates the right home for the shared code.

### D2 — Shared code location: extract's TS pipeline OR a new shared-utils workspace

**Decision:** Phase 0 decides. Two candidates on the table; the investigation output pins the home.

**Candidates:**

- **`packages/extract/pipeline/mdx-preprocessor.ts`** — lives alongside the existing pipeline helpers (`applyUnitFallback`, `resolveTransformPlaceholders`). Pros: already a shared TS surface consumed by both plugins via `@animus-ui/extract/pipeline`. Cons: expands the pipeline-surface concept from "post-NAPI processing" to "pre-NAPI preprocessing" — arguable fit.
- **`packages/_plugin-shared/src/mdx-preprocessor.ts`** (new package, like `_integration` and `_assertions`). Pros: cleanly-scoped "plugin-adapter-shared-helpers" surface. Cons: another private workspace to maintain; no compelling reason to need it yet beyond this one helper.

**Alternatives considered:**

- **Inline copies per plugin.** Rejected. Guaranteed drift, doubles surface area.
- **NPM dep on `@mdx-js/mdx` in each plugin directly + duplicate compile-to-JSX logic.** Rejected — the "compile-to-JSX" logic is identical; extracting it as a single helper is trivial.

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

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `@mdx-js/mdx`'s `compile()` output format differs between versions and breaks our pre-processor's JSX extraction | Pin the direct dep at a specific minor version; verify compatibility in CI; surface version on pre-processing-error warning text. |
| MDX files contain JSX that relies on MDX-provider-supplied components (e.g. `<h1>` mapped to `Heading` via `<MDXProvider components={{ h1: Heading }}>`) — scanner sees `<h1>` but not the rendered mapping | Explicitly out of scope per proposal. Document the limitation in `jsx-system-prop-scanner` CLAUDE notes or equivalent. If this becomes a user-visible gap (e.g. `Heading` silently eliminated despite MDX usage), scope a follow-on. |
| Adding `.mdx` to the extension set in next-plugin may cause it to walk files it didn't before, increasing buildStart time | Measure pre/post buildStart timing in showcase + next-app. If non-trivial overhead, add an opt-out or per-project config. |
| Fixture may need its own MDX plugin wiring in the integration-test harness (since `_integration` doesn't currently compile MDX) | Integration test may use `@mdx-js/mdx` directly to synthesize the scanner input; no need to involve the bundler in the test tier. |
| Pre-processor extracts JSX regions but loses source-position fidelity for JSX scanner's error reporting | Source maps from `@mdx-js/mdx`'s `compile()` should suffice. Validate in Phase 1 that scanner error reporting still produces usable file:line on an MDX syntax error. |
| `verify:build:next` CI run requires next-plugin's MDX handling to work with next's own MDX infrastructure — adapter-level tests may uncover interactions | Run `verify:build:next` after next-plugin changes, paralleling the existing prior-arc Phase 4 validation approach. |

## Migration Plan

Behavioral-only change for consumers; new direct dep on `@mdx-js/mdx` for plugin packages. Deploy per phase:

1. **Phase 0** — Localize the bug: write the minimized fixture (ds-built component rendered only from MDX), confirm regression reproduces, confirm fresh dev-mode manifest shows prospective entry (post-Phase-4 diagnostic).
2. **Phase 1** — Implement the pre-processor + wire into vite-plugin. Verify showcase + vite-app builds extract the MDX-rendered component.
3. **Phase 2** — Wire into next-plugin. Verify next-app builds extract the MDX-rendered component.
4. **Phase 3** — Showcase rule-count re-audit post-fix (MetricGrid in dist CSS).
5. **Phase 4** — Archive.

Each phase is an isolated commit; revert per-phase if post-land issues surface.

## Open Questions

**OQ1 — `packages/extract/pipeline/` vs new `packages/_plugin-shared/` for the preprocessor location?** Decide via a quick probe: if extract's `pipeline/` already has no "pre-NAPI" modules, and the concept of "pre-NAPI plugin helpers" sits oddly there, favor the new package. If extract's pipeline is a loose bag of plugin helpers that happen to currently all run post-NAPI, expanding to pre-NAPI is fine.

**OQ2 — MDX-provider-mapped components (e.g. `<h1>` → Heading via MDXProvider) — in scope or deferred?** Default: deferred (per proposal non-goals). Flag for scope re-evaluation if showcase or next-app reveal any OTHER component that's eliminated due to this subtler gap after THIS change lands.

**OQ3 — Does next-plugin's MDX support (if any) differ semantically from vite's?** Next has its own MDX story (`@next/mdx`). The extractor's pre-processor is bundler-agnostic (just takes MDX source, returns JSX), but the ways MDX references flow at runtime may differ. Confirm via a minimum next-app MDX fixture in Phase 2.

**OQ4 — Should the MDX extension set be configurable (e.g. `animusExtract({ extensions: ['.mdx', '.md'] })`) or hardcoded?** Default: hardcoded to `.mdx` for this change. Configurable-extensions is D1-C's deferred path — premature today.

**OQ5 — Does adding MDX to discovery increase buildStart latency noticeably?** Measure pre/post in showcase + next-app. Data informs whether the default-on vs default-off decision needs revisiting.

**OQ6 — Does the same gap affect `.md` files that contain JSX through remark-jsx-style extensions?** Default: out of scope, `.mdx` only. Raise in follow-on if a consumer reports it.
