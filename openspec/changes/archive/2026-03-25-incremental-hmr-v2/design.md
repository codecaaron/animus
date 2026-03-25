## Context

`analyzeProject()` is called on every HMR file change. It re-parses all files via OXC, rebuilds the full import graph, resolves extension chains, scans JSX usage, reconciles dead variants/states, and generates ordered CSS.

The Rust analysis phases break down roughly as:

| Phase | Time (estimated) |
|-------|-----------------|
| OXC parse + chain walk + style eval (per-file) | ~1.5ms/file |
| Import resolution + binding map | ~2ms |
| Extension provenance + topo sort | ~1ms |
| Extension merging | ~1ms |
| JSX scanning (all files) | ~3ms |
| Reconciliation | ~1ms |
| CSS generation | ~1ms |

Per-file parsing dominates on the Rust side. Cross-file phases are fast because they operate on pre-extracted data structures, not raw source.

**Important: The total HMR wall-clock time (~60ms for 32 files) includes significant JS overhead** — JSON serialization of file entries, NAPI boundary crossing (string → Rust → string), transform resolution, and Vite module graph invalidation/reload. The Rust cache eliminates the Rust-side parsing cost but cannot address the JS orchestration cost. See Post-Implementation Assessment in proposal.md.

Current `analyzeProject()` was stateless — every call received all files, processed everything, returned everything. This change adds a Rust-side persistent per-file cache so unchanged files skip parsing.

## Goals / Non-Goals

**Goals:**
- Eliminate redundant OXC parsing of unchanged files on HMR (Rust-side optimization)
- Keep Rust as the single source of truth for analysis — no JS-side manifest merging
- Maintain identical prod build behavior (no caching, full reconciliation)
- Verify cache correctness via canary tests (cached result matches full re-analysis)

**Non-Goals:**
- Reducing JS-side overhead (NAPI serialization, Vite module graph ops) — architectural floor, separate concern
- CSSOM-level patching (Level 3 incremental — future spike)
- JS-side manifest merging from per-file `extract()` results (original proposal, rejected)
- Incremental import resolution (cross-file phases are already fast)
- Persistent on-disk cache (in-memory only, cleared on server restart)
- Plugin-side selective module invalidation (see D6 retrospective)

## Decisions

### D1: Rust-side persistent state via module-level `Mutex`

The Rust crate needs to maintain state between `analyzeProject()` calls. Two options considered:

**Option A: `thread_local!` with `RefCell`** — Cache lives in thread-local storage. Zero synchronization. But if Bun's NAPI calls ever execute on a different thread (worker threads, internal scheduler), each thread gets an independent empty cache — silent full-parse behavior with no errors or warnings.

**Option B: Module-level `Mutex<HashMap>`** — Cache behind a Mutex. Safe for any threading model. Lock overhead for 32-entry HashMap lookup is microseconds — negligible vs 57ms baseline.

**Decision: Option B (`Mutex`).** The lock cost is immeasurable against the parse savings. Correctness across all NAPI runtimes (Node.js, Bun, Deno) is worth more than zero-cost synchronization that silently breaks under threading.

```rust
use std::sync::Mutex;
use once_cell::sync::Lazy;

static FILE_CACHE: Lazy<Mutex<HashMap<String, CachedFileResult>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
```

### D2: Cache key is content hash, not file path

Files are identified by `(path, content_hash)`. If the hash matches, the cached result is reused. If the hash differs or the file is new, it's re-parsed. If a cached file is absent from the input list, it's evicted.

This means the plugin doesn't need to explicitly track "which files changed" — it passes all files with their hashes, and Rust determines staleness internally.

**Alternative considered:** Plugin passes explicit `changed_files: string[]`. Rejected because it requires the plugin to track change state, which it already does via content hashes. Passing hashes is more declarative and idempotent.

### D3: `FileEntry` gains an optional `hash` field

```rust
struct FileEntry {
    path: String,
    source: String,
    hash: Option<String>,  // NEW: content hash from plugin
}
```

When `hash` is `Some` and matches the cached entry for that path, the file's source is ignored and cached extraction results are used. When `hash` is `None`, the file is always re-parsed (backward compatible — existing callers without hashes get full analysis).

### D4: CachedFileResult stores the full evaluation result, not just CSS

The cache must store enough data to reconstruct the `evaluated` HashMap entry for unchanged files. The `evaluated` map is consumed by extension merging (reads parent entries), system_props population (mutates entries), and manifest generation. If cached files don't populate `evaluated`, extension chains break silently and system_props are missing from the manifest.

```rust
struct CachedFileResult {
    hash: String,
    module_info: FileModuleInfo,          // imports/exports for binding resolution
    chains: Vec<ChainDescriptor>,         // extracted builder chains
    eval_results: Vec<CachedEvalEntry>,   // full per-component evaluation results
    jsx_usage: UsageScanResult,           // JSX prop/variant/state usage
}

struct CachedEvalEntry {
    component_id: String,
    component_css: ComponentCss,          // pre-merge styles (child's own)
    replacement: ComponentReplacement,    // variant_config, state_names, system_props
    active_props: Option<HashSet<String>>,
    prop_config: Option<PropConfigMap>,
}
```

On cache hit, each `CachedEvalEntry` is inserted into the `evaluated` HashMap so downstream phases see it identically to a freshly-processed entry. On cache miss (re-parsed file), the new evaluation results replace the cached entries.

All fields use owned Rust types (`String`, `Vec`, `HashMap`). No references to OXC arena-allocated AST nodes. The arena drops after parsing; cached data survives independently.

**Accumulated usage ledger:** The per-file `jsx_usage` stored in `CachedFileResult` IS the accumulated usage state. In dev mode, unchanged files' cached `jsx_usage` is merged with changed files' fresh `jsx_usage` via union to build the usage ledger. Geological resets clear `FILE_CACHE`, which clears all cached `jsx_usage` — the ledger resets to the fresh full-analysis state. No separate persistence mechanism needed.

### D5: Dev-mode flag enables incremental JSX scanning and skips reconciliation

```rust
fn analyze(
    files: Vec<FileEntry>,
    theme: &Theme,
    config: &Config,
    // ...existing params...
    dev_mode: bool,  // NEW
) -> UniverseManifest
```

When `dev_mode` is true:
- Phase 5b (JSX scanning): run ONLY on changed files (cache miss). Reuse cached `UsageScanResult` for unchanged files. Merge new scan results into accumulated usage ledger via union (additive only — never remove previously-seen values). This ensures new `<Box p={8}>` usages are detected while avoiding re-scanning all 32 files.
- Skip Phase 5e (reconciliation) — saves ~1ms. No variants, states, components, or system prop utilities are pruned.
- CSS generation uses all extracted components without pruning.

When `dev_mode` is false (prod builds):
- Full analysis unchanged — scan all files, reconcile, prune

### D6: Early-exit via ComponentCss comparison (foundation only)

`PartialEq` is derived on `ComponentCss` and nested types to enable structural comparison between cached and freshly-extracted results. This is a foundation for future per-component CSS patching (Level 3 incremental) but is NOT currently used for CSS regen gating. CSS generation always runs on the full ordered component list.

The original design included "Layer 1 early-exit: if ComponentCss unchanged, skip CSS regen." In practice, CSS generation is fast (~1ms for 32 components) and operates on the full ordered list, so per-component skipping would add branch complexity for negligible savings. The `PartialEq` derives remain as infrastructure for future use.

### D6b: Surgical invalidation — retrospective (shipped but reassessed)

During implementation, a `structuralSignature()` function was added to the plugin to compare component replacement strings before and after analysis, excluding `systemProps` and `systemPropNames`. The intent: only re-transform definition files where the structural config (tag, className, variants, states) changed, not when system_props changed due to JSX edits in consumer files.

**Assessment:** This optimization adds complexity (JSON.parse of every component config, prevReplacements map, set diffing) but did not measurably reduce total HMR latency. Vite's `invalidateModule()` is a cheap flag flip. The cost it was trying to avoid (re-running the transform hook on unchanged definition files) is bounded by the number of definition files and dominated by the overall HMR cycle time.

**Status:** REMOVED. Replaced with simple string comparison (`replacement !== prevReplacement`). If a component's replacement string changed at all (including systemProps), its definition file is invalidated. Simpler, correct, no JSON parsing overhead. The "surgical" approach was solving the wrong problem — Vite's invalidateModule is a flag flip, so avoiding it has negligible benefit.

### D7: NAPI interface — extend `analyzeProject()` signature

**Option A: New parameter on existing function.**
```rust
#[napi]
fn analyze_project(
    file_entries_json: String,  // now includes hash field
    // ...existing params...
    dev_mode: Option<bool>,     // NEW, optional for backward compat
) -> String
```

**Option B: New function `analyze_project_dev()`.**

**Decision: Option A.** Adding an optional parameter is backward-compatible. Existing callers (canary tests, prod builds) pass `None` or omit it and get full analysis. Dev-mode callers pass `Some(true)`.

The `file_entries_json` format changes from `[{path, source}]` to `[{path, source, hash?}]`. The `hash` field is optional — entries without it are always re-parsed.

## Risks / Trade-offs

**[Risk] Cache staleness on edge cases** → If a file's content hash collides (MD5 collision), stale cached data would be used. Mitigation: MD5 collisions are astronomically unlikely for source files. If paranoia warrants it, switch to xxhash (faster, better distribution). The plugin already uses MD5 for content-hash checks.

**[Risk] Memory growth from only-grow dev strategy** → Dev CSS monotonically grows as new variant values and system prop classes are encountered. For a 32-file project this is negligible. For a 500-component monorepo, it could accumulate significantly over a long dev session. Mitigation: geological resets (theme/config change) clear the cache and do full analysis. Restarting the dev server also clears. The CSS isn't shipped — it's dev-only.

**[Risk] Cache invalidation on Rust crate update** → If the extraction logic changes (style_evaluator, chain_walker), cached results from the old code could be incompatible. Mitigation: dev server restart clears the cache. NAPI binary replacement requires a server restart anyway.

**[Risk] `PartialEq` derivation on ComponentCss** → If ComponentCss contains floating-point values or non-deterministic fields, equality comparison could give false negatives (unnecessary re-generation). Mitigation: ComponentCss contains only strings and string-keyed maps. No floats. Deterministic by construction.

**[Trade-off] Cross-file phases still run on every HMR** → Import resolution, topo sort, and extension merging still execute on every change (~5ms). This is acceptable because: (a) they're fast, (b) caching them requires tracking the import graph for invalidation (complex), (c) they use cached FileModuleInfo so no re-parsing is needed.

**[Critical detail] CachedFileResult stores PRE-MERGE ComponentCss** → The cache stores each file's OWN styles before extension merging. The merge phase runs every time in topo order, combining fresh or cached parent CSS with fresh or cached child CSS. This ensures extension chains are correct when a parent changes but children don't: the parent's fresh CSS is merged with the child's cached own-styles to produce the correct merged output. If we cached POST-MERGE CSS, a parent edit would silently produce stale merged results for unchanged children.

## Open Questions

### Q1: What is Vite's intrinsic HMR latency?

The ~60ms total HMR time may include significant Vite-intrinsic overhead: file system watcher notification, module graph traversal, WebSocket push to browser, browser module re-request, React component re-render. This baseline was never measured independently.

**To determine:** Temporarily disable the animus plugin, make a plain JSX edit (e.g., change a string literal), measure Vite's native HMR cycle time for the showcase project. If the baseline is already 40-50ms, then the plugin overhead is only 10-15ms (well within acceptable bounds, and the Rust cache already minimized our contribution).

This distinction matters for future optimization decisions. If the floor is Vite's, there's nothing to optimize on our side. If Vite's baseline is 20ms and we're adding 40ms, there's NAPI serialization work worth doing.

### Q2: Serialization cost at scale (code-split apps)

Every HMR cycle iterates all tracked files to build the NAPI payload. For the 32-file showcase, this is negligible. For a code-split app with many routes, the total file count could be 200+. The current architecture sends `{ path, source: '', hash }` for unchanged files (~80 bytes/entry) — small per-entry but O(total-files) per cycle.

Alternative architecture: send only changed file(s) + a path list for eviction. Rust uses its cache for everything not in the changed set. This would make NAPI payload O(changed-files) instead of O(total-files). However, it requires Rust to track the full file set internally rather than deriving it from the input. Deferred as a future optimization — needs real-world scale testing to justify the architectural change.

## Code Removal Provenance

Removals made during post-implementation cleanup. Each entry traces what was removed, why it existed, whether any spec references it, and whether the removal is safe.

### Plugin: `structuralSignature()` function

- **What:** Function that JSON.parsed a `createComponent()` config string, deleted `systemProps`/`systemPropNames`, and returned the remaining JSON as a comparison key.
- **Why it existed:** Attempted to exclude system prop changes from module invalidation diffing, so that changing JSX usage in a consumer file wouldn't re-transform definition files. Added during incremental-hmr-v2 implementation.
- **Spec references:** Only in this change's proposal and design (D6b). No main spec references. Delta spec for vite-extraction-plugin does NOT mention it.
- **Replacement:** Simple string comparison (`replacement !== prevReplacement`). If replacement changed at all, invalidate.
- **Safe:** Yes. Builds pass. The function was added in this change and never synced to main specs.

### Plugin: `structuralSignature`-based conditional in invalidation loop

- **What:** The invalidation check `structuralSignature(new) !== structuralSignature(old)` was an additional gate beyond `new !== old`.
- **Why it existed:** To prevent re-transforming definition files when ONLY systemProps changed (from JSX consumer edits).
- **Replacement:** Plain `newReplacement !== oldReplacement` check. More conservative (more invalidation) but correct and simpler.
- **Safe:** Yes. Over-invalidation is a correctness improvement (ensures stale transforms can't persist).

### Rust: `generate_css_ordered()` function (css_generator.rs)

- **What:** Generated concatenated CSS string with topological ordering. ~50 lines.
- **Why it existed:** Original CSS generation entry point before `CssSheets` was introduced. Superseded by `generate_css_sheets_ordered()` in the `static-adopted-split` change.
- **Spec references:** Referenced in ARCHIVED changes only: `arc-4-usage-reconciliation` (tasks.md:33, design.md:30) and `static-adopted-split` (design.md:49). NOT in any main spec. The main `structured-css-sheets` spec describes the sheets API, not this function.
- **Safe:** Yes. Only called by `generate_css_from_slice()` (also removed) and imported (unused) in project_analyzer.rs. `generate_css_sheets_ordered()` is the active replacement. Builds pass.

### Rust: `generate_css_from_slice()` function (css_generator.rs)

- **What:** Internal helper that called `generate_sheets_from_slice()` and concatenated the result. ~20 lines.
- **Why it existed:** Called only by `generate_css_ordered()`. Part of the pre-sheets string-based CSS generation path.
- **Spec references:** None.
- **Safe:** Yes. Only caller was `generate_css_ordered()` (also removed). Builds pass.

### Rust: `Breakpoints` struct (theme_resolver.rs)

- **What:** Serde-deserializable struct with optional `xs/sm/md/lg/xl` u32 fields.
- **Why it existed:** Early breakpoint representation, likely from Arc 1-2. Never constructed in production code — `BreakpointMap` (a `HashMap<String, u32>` in css_generator.rs) is used instead.
- **Spec references:** The `system-builder` spec mentions a TypeScript `Breakpoints` type — this is the TS interface in `packages/system/src/types/theme.ts`, NOT the Rust struct. No Rust spec references this struct.
- **Safe:** Yes. Never instantiated. Builds pass.

### Rust: `TERMINAL_METHODS` constant (chain_walker.rs)

- **What:** `const TERMINAL_METHODS: &[&str] = &["asElement", "asComponent"]`
- **Why it existed:** Likely an early constant for terminal method matching. The chain walker uses inline string comparisons (`"asElement"`, `"asComponent"`) directly in the match logic, not this constant.
- **Spec references:** The `rust-extraction-pipeline` spec describes terminal recognition behavior but does not reference this constant by name.
- **Safe:** Yes. Never referenced. Builds pass.

### Rust: Unused imports (6 items in project_analyzer.rs)

| Import | Reason unused |
|--------|--------------|
| `merge_chain_configs` | Function exists in chain_merger.rs and is used by its own tests, but project_analyzer.rs never calls it. Extension merging uses inline logic. |
| `generate_css_ordered` | Superseded by `generate_css_sheets_ordered`. Import was stale. |
| `resolve_styles` | Function exists in theme_resolver.rs. Project analyzer uses theme data passed as parameters, not direct resolve calls. |
| `parse_object_from_source` | Function in lib.rs for per-file extraction. Project analyzer uses `process_chain` instead. |
| `parse_variant_from_source` | Same pattern — lib.rs helper not used in project analysis. |

- **Spec references:** None reference these imports. The functions themselves still exist and are used by their own modules.
- **Safe:** Yes. Import-only cleanup. Functions not deleted. Builds pass.

### Rust: Unused imports (3 items in other files)

| Import | File | Reason |
|--------|------|--------|
| `parse_states_arg` | lib.rs | Function exists in style_evaluator.rs but is never called from lib.rs. States are parsed via `process_chain` flow. Referenced in archived `per-property-bail` task but that work is done. |
| `Argument` | style_evaluator.rs | OXC AST type, no longer needed after refactoring. |
| `VariantCss` (top-level) | reconciler.rs | Test module re-imports it independently via `use crate::css_generator::{ComponentCss, VariantCss}`. Top-level import was only needed by tests via `super::*` but tests have their own explicit import. |

- **Spec references:** None.
- **Safe:** Yes. Import-only cleanup. Builds pass.

### Items NOT removed (assessed but kept)

| Item | File | Why kept |
|------|------|----------|
| `parse_states_arg()` function | style_evaluator.rs | Dead in production but function body exists with no callers. Could be useful for future per-file extraction. Low cost to keep. |
| `BAIL_METHODS` constant (empty) | chain_walker.rs | Intentionally empty with explanatory comment. Documents that extend is no longer a universal bail. |
| `span` field on `ComponentReplacement` | transform_emitter.rs | Cargo warns "never read" but kept for future source mapping support. |
| `is_default` field on `ImportInfo`/`ExportInfo` | import_resolver.rs | Cargo warns "never read" but kept for potential future API surface (re-export analysis). |
| `merge_chain_configs()` function | chain_merger.rs | Used by its own test suite. The import in project_analyzer was dead, not the function. |
| `PartialEq` derives on ComponentCss | css_generator.rs | Foundation for Layer 1 early-exit (not yet implemented). Used in canary test assertions. |

### Spec sync impact

**No main spec changes needed.** All removed items were either:
- Implementation artifacts never referenced in specs (constants, internal helpers)
- Superseded by newer functions already described in specs (`generate_css_sheets_ordered` replaces `generate_css_ordered`)
- Plugin-side optimizations from this change that were never synced (surgical invalidation)

The delta specs for this change (`incremental-analysis-cache`, `dev-mode-only-grow`, `project-analyzer`, `vite-extraction-plugin`) remain accurate — none describe the removed items.
