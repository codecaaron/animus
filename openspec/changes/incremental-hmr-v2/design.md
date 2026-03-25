## Context

`analyzeProject()` is called on every HMR file change. It re-parses all files via OXC, rebuilds the full import graph, resolves extension chains, scans JSX usage, reconciles dead variants/states, and generates ordered CSS. For 32 files this takes ~57ms. The cost breakdown:

| Phase | Time | % |
|-------|------|---|
| OXC parse + chain walk + style eval (per-file) | ~48ms | 84% |
| Import resolution + binding map | ~2ms | 3% |
| Extension provenance + topo sort | ~1ms | 2% |
| Extension merging | ~1ms | 2% |
| JSX scanning (all files) | ~3ms | 5% |
| Reconciliation | ~1ms | 2% |
| CSS generation | ~1ms | 2% |

The per-file parsing dominates. Cross-file phases are fast because they operate on pre-extracted data structures, not raw source.

Current `analyzeProject()` is stateless — every call receives all files, processes everything, returns everything. No state persists between calls. The NAPI boundary enforces this: Rust functions are called, do work, return results, drop all state.

## Goals / Non-Goals

**Goals:**
- Reduce HMR latency for single-file style edits from ~57ms to <10ms (32-file project)
- Keep Rust as the single source of truth for analysis — no JS-side manifest merging
- Maintain identical prod build behavior (no caching, full reconciliation)
- Verify cache correctness via canary tests (cached result matches full re-analysis)

**Non-Goals:**
- CSSOM-level patching (Level 3 incremental — future spike)
- JS-side manifest merging from per-file `extract()` results (original proposal, rejected)
- Incremental import resolution (cross-file phases are already fast at ~9ms)
- Persistent on-disk cache (in-memory only, cleared on server restart)

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

### D6: Early-exit via ComponentCss comparison

After re-parsing a changed file, compare the new `ComponentCss` results against the cached versions. If structurally identical (same base styles, same variant options, same state styles), the CSS contribution from this file hasn't changed. Cross-file phases still run (extension merging, system_props), but the system can log "styles unchanged" for diagnostics.

This catches "I edited JSX layout but didn't touch styles" — the file re-parses but extracted styles are identical. Note: CSS generation must still run because it operates on the full ordered component list. The early-exit value is primarily diagnostic (skip verbose logging) and a foundation for future per-component CSS patching (Level 3 incremental).

Implementation: derive `PartialEq` on `ComponentCss` and its nested types.

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
