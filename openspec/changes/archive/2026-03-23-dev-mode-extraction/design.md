## Context

The Vite plugin (`packages/vite-plugin/src/index.ts`) currently gates extraction behind `if (!isProd) return` at line 285 of `buildStart`. In dev mode, it evaluates theme/config but skips file discovery, `analyzeProject`, and source transformation. The virtual CSS module serves only theme variable CSS — no component styles.

The plugin already has the full extraction pipeline implemented for production:
- `buildStart`: config resolution (bun subprocess), theme evaluation (bun subprocess), file discovery, package resolution, `analyzeProject` (Rust NAPI)
- `transform`: per-file source replacement using the stored manifest
- `load`: serves the virtual CSS module (`virtual:animus/styles.css`)

The Rust `analyzeProject` function in `project_analyzer.rs` runs a 7-phase pipeline: parse all files → resolve imports → build extension provenance → topological sort → evaluate chains + JSX scan + reconcile → generate replacements → build manifest. This is inherently project-wide due to cross-file import resolution and extension chain ordering.

## Goals / Non-Goals

**Goals:**
- Dev mode runs the same extraction pipeline as production (no behavioral divergence)
- Single-file style changes update CSS without React state loss (CSS-only HMR)
- Content-hash file cache minimizes redundant disk I/O during HMR
- Config/theme file changes trigger full re-extraction (geological reset)
- The `configPath` option works identically in dev and prod

**Non-Goals:**
- Rust-level incremental analysis (re-parse only changed files in Rust). The JS caching layer + OXC's ~1ms/file parse speed makes this unnecessary for v1.
- Per-file `extract()` NAPI function. The project-level `analyzeProject` is the only path that handles extensions, import resolution, and reconciliation.
- Distinguishing "style-only" vs "JSX" changes for surgical HMR. v1 always does CSS module invalidation + default Vite module HMR. React Fast Refresh preserves state when the component tree is unchanged.
- Dev-mode dead variant elimination. Reconciliation runs but elimination is most valuable for production bundle size.

## Decisions

### 1. Remove the `isProd` gate entirely — dev and prod share one pipeline

**Why not a separate dev-mode-only extraction path?**

The production pipeline (`buildStart` → `analyzeProject` → `transform` → `load`) handles cross-file extensions, package resolution, and reconciliation. Building a parallel dev-mode pipeline that handles even a subset of these features would duplicate logic and diverge over time. The simpler approach: remove the gate, let the same code run in both modes, and add HMR hooks for the dev-specific concern (incremental updates).

**Alternative considered:** Per-file `extract()` in dev, `analyzeProject` in prod. Rejected because `extract()` cannot resolve cross-file extension chains (the showcase uses `SmallButton = Button.extend()...` across files), cannot do reconciliation, and would produce different CSS output than production — defeating the purpose of dev-mode extraction.

### 2. Full `analyzeProject` on every HMR event (with JS-level file caching)

The HMR handler re-runs `analyzeProject` with the full file entries array on every relevant file change. A JS `Map<path, { hash, source }>` caches file contents — only the changed file is re-read from disk. All other entries use their cached source strings.

**Why not Rust-level incremental analysis?**

The Rust pipeline's phases (import resolution, topological sort, JSX scanning, reconciliation) all operate on the full project graph. Making these incremental requires significant Rust refactoring with subtle correctness risks (stale cross-references, missing transitive dependencies). OXC parses at ~1ms/file, so re-parsing 100 cached source strings costs ~100ms — acceptable for dev HMR where the alternative is a full page reload (~500ms+).

**Performance budget:**
- Disk I/O for 1 file: ~1ms
- `analyzeProject` for 100 files (cached sources): ~100-200ms
- Transform resolution (bun subprocess): ~50ms
- CSS module invalidation: <1ms
- Total: ~150-250ms per HMR cycle

This is well under the perceived-lag threshold (~300ms) and dramatically faster than a full page reload. The 50ms target from the proposal was aspirational — 150-250ms is the realistic v1 target.

### 3. `transform` hook runs in both dev and prod

**Why this is mandatory:**

Without source transformation, components render via Emotion's runtime (style injection into `<style>` tags). But the virtual CSS module contains extracted CSS wrapped in `@layer base { ... }`. CSS `@layer` has LOWER specificity than unlayered styles. Emotion's injected styles are unlayered → they override extracted styles → components get double-styled or show the wrong styles.

By running the `transform` hook in dev, builder chains are replaced with `createComponent(...)` shim calls. Components use the extraction runtime (static class names) rather than Emotion. CSS comes entirely from the virtual module. No specificity conflicts.

**Alternative considered:** Keep Emotion in dev, extraction in prod. Rejected due to the @layer specificity conflict and the principle that dev/prod rendering paths should be identical to prevent "works in dev, broken in prod" bugs.

### 4. Three-tier temporal escalation in `handleHotUpdate`

File changes are classified into three tiers based on what they affect:

| Tier | Trigger | Action |
|------|---------|--------|
| **Heartbeat** | File saved, content hash unchanged | Return early — no work |
| **Diurnal** | Component/style file changed | Update cache entry, re-run `analyzeProject`, invalidate CSS module |
| **Geological** | Config file or theme file changed | Re-evaluate config/theme via bun subprocess, then full re-extraction |

The `handleHotUpdate` hook detects which tier applies and escalates appropriately. Geological resets are rare (config/theme changes are infrequent) but must be handled to prevent stale extraction state.

### 5. CSS module invalidation via `server.moduleGraph`

When extraction produces new CSS:
1. Look up the virtual CSS module: `server.moduleGraph.getModuleById(RESOLVED_CSS_ID)`
2. Invalidate it: `server.moduleGraph.invalidateModule(cssModule)`
3. The `load` hook will be re-invoked on next request, serving the updated CSS
4. Vite's native CSS HMR sends the update to the client
5. Client replaces `<style>` content — no JS re-execution, no React re-render for CSS-only changes

We do NOT suppress default module invalidation for the changed file. Vite will also HMR the component module if its source changed. React Fast Refresh handles this gracefully — if the component tree structure is unchanged, state is preserved.

## Risks / Trade-offs

**[150-250ms HMR latency]** → Full `analyzeProject` re-run is slower than per-file extraction would be. Mitigation: acceptable for dev (faster than full reload), and Rust-level incremental analysis can be added later as an optimization without changing the plugin's external behavior.

**[Bun subprocess overhead on geological reset]** → Config/theme changes spawn `execSync('bun -e ...')`. Mitigation: geological resets are rare (config changes are infrequent). The subprocess overhead (~200ms) is amortized by the rarity of the event.

**[Virtual CSS module size in dev]** → The virtual module contains ALL extracted CSS for the entire project. For large projects this could be several hundred KB. Mitigation: Vite serves dev assets unminified anyway. The browser parses CSS incrementally. This is a dev-only concern — production uses the optimized build.

**[Transform hook in dev may slow module serving]** → The `transform` hook runs for every relevant module request. Mitigation: the hook is fast — it just calls `transformFile` (Rust NAPI) with the stored manifest. The actual extraction was already done at `buildStart`; transform just applies pre-computed replacements.

**[File cache memory usage]** → Storing all file sources in a JS Map. Mitigation: for a 100-file project with ~50KB avg source, this is ~5MB — negligible for a dev server process.
