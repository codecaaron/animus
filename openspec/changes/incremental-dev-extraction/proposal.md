## Why

Dev-mode extraction (just shipped) re-runs full `analyzeProject` on every file save. This works for small projects (~30 files, <200ms) but will degrade at scale. Two approaches could reduce HMR latency to near-zero regardless of project size.

This is a **spike proposal** — documenting the options and questions to investigate, not committing to an implementation path yet.

## Approach B: Incremental Rust Analysis (`patchFile`)

New NAPI function: `patchFile(manifest, filePath, newSource, theme, config, groupRegistry) → patchedManifest`

**The idea:** Re-parse only the changed file, diff against existing manifest entries, patch just the affected CSS rules. Everything else (import graph, topo order, JSX usage, reconciliation) is cached in the manifest.

**What it buys:** ~20ms HMR for style-only edits (vs ~150ms full re-analysis). O(1) in project size.

**Open questions to spike:**
- Can the manifest store enough intermediate state to make patching possible without re-running import resolution?
- How to detect "structural change" (new chain, new variant) vs "value change" (style edit) — the boundary between patch and escalate-to-full?
- Cross-file extension chains: if parent's styles change, child needs update. Can we trace this from the manifest's provenance map?
- JSX usage changes in OTHER files: these can't be detected without scanning those files. Is this acceptable to skip in dev (no reconciliation anyway)?

**Rust work estimate:** Moderate. New NAPI function, chain diffing logic, CSS string splicing. Reuses existing parsing/evaluation.

## Approach C: Full Universe + Live CSS Rule Patching

**The idea:** Two-track architecture. Dev skips reconciliation entirely, serves the FULL CSS universe (every variant, every state, every possible rule). On HMR, re-evaluate only the changed chains and patch individual CSS rules in the browser.

**What it buys:** Sub-millisecond HMR. O(changed rules) not O(files). No React re-render for style-only changes.

**The dev/prod split:**
- **Prod:** `analyzeProject` → reconciliation → minified bundle (what ships)
- **Dev:** `analyzeProject` (no reconcile) at startup → `extractChains` per-file on edit → live CSS rule patching

**Open questions to spike:**
- Does the `CSSStyleSheet` API support modifying rules inside `@layer` blocks? `@layer` is relatively new in CSSOM. If `CSSGroupingRule` traversal works for `@layer`, this is viable. If not, we need a different injection strategy (one `<style>` per component? inline rules without layers in dev?).
- Can we skip `@layer` in dev entirely? Dev doesn't need cascade guarantees if all styles are present — specificity is handled by class name uniqueness. Removing layers simplifies CSS rule patching to flat rule replacement.
- What's the right delivery mechanism for rule deltas? Options: custom Vite websocket message, custom HMR handler in the runtime shim, or a `__vite_plugin_animus` global that the runtime polls.
- How does the browser runtime manage the selector→CSSRule index? On initial load, it needs to parse the full CSS and build the index. On rule addition (new component), it needs to insert into the right layer position.
- Transform resolution for individual rules: currently transforms are resolved via bun subprocess on the full CSS string. Per-rule resolution would need an in-process transform registry instead.

**New infrastructure needed:**
1. Rust: `extractChains(file, source, theme, config, groupRegistry) → Vec<(selector, cssBody)>` — lightweight per-file extraction, no project analysis
2. JS plugin: per-component CSS map (not concatenated string)
3. Browser: CSS rule patching runtime (~1-2KB)
4. Plugin↔Browser: delta delivery channel

## Recommendation

**Don't build either yet.** Approach A (full re-analysis) is fast enough for current use. When a project exceeds ~200 files and HMR latency becomes perceptible:

1. **Spike first:** Write a minimal test to answer the `@layer` CSSOM question. If `CSSGroupingRule` traversal works, Approach C is viable and strictly superior.
2. **If C is viable:** Build it. The two-track architecture (dev=full universe, prod=reconciled) is the cleanest long-term design.
3. **If C is blocked by CSSOM limitations:** Fall back to B (incremental Rust). More complex but no browser-side innovation needed.

## Capabilities

### New Capabilities (potential)
- `incremental-extraction`: Per-file chain extraction without full project analysis
- `live-css-patching`: Browser-side CSS rule replacement via CSSOM API

## Impact

- **`packages/extract/src/`**: New NAPI function(s) for per-file extraction
- **`packages/vite-plugin/src/`**: Per-component CSS storage, delta delivery
- **`packages/runtime/src/`**: CSS rule patching runtime (Approach C only)
- **Developer experience**: Sub-10ms HMR on any project size
