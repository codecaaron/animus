## Context

Sessions 62–67 moved all three subprocess operations (transform evaluation, global styles resolution, system module loading) into the Rust NAPI crate. Both plugins now call NAPI functions exclusively. The plugin code, docs, and CSS delivery architecture have not been updated to reflect this.

The CSS generation pipeline currently concatenates all component CSS into per-layer strings (`CssSheets`). Individual component contributions are lost after `generate_layer_content_slice()`. This blocks incremental HMR (can't splice one component's CSS without regenerating everything) and future route-level code-splitting (can't identify which CSS belongs to which components).

Measured from showcase: 196 components, 51 files, 149 KB total CSS. The 4 splittable layers (base, variants, compounds, states) account for 142 KB (95.6%). System/custom utilities (9.5 KB) are cross-cutting and stay monolithic.

## Goals / Non-Goals

**Goals:**
- Fix next-plugin selectorAliases/selectorOrder bug (correctness)
- Remove dead subprocess code and stale references (hygiene)
- Retain per-component CSS fragments in the Rust crate for the 4 splittable layers
- Expose fragments in the NAPI manifest for plugin consumption
- Enable incremental HMR splice in both plugins (replace only changed file's fragments)
- Build reverse adjacency index for transitive `.extend()` invalidation

**Non-Goals:**
- Multi-sheet adopted stylesheets for dev HMR (future — builds on fragments)
- SSR route-level code-splitting (future — needs route→file mapping from bundler)
- Per-route CSS file generation in next-plugin (future)
- Changing the consumer API (`animusExtract()` options, `withAnimus()` options)

## Decisions

### 1. Fragment container: Vec + FxHashMap side index

**Choice:** `Vec<(String, String)>` for ordered storage, `FxHashMap<String, usize>` for O(1) lookup by component_id.

**Why not HashMap:** Unordered — CSS cascade depends on topological insertion order (reconciled_order). Emitting fragments in wrong order changes cascade semantics.

**Why not IndexMap:** Would work but adds a crate dependency not currently in Cargo.toml. The Vec + side index pattern is idiomatic Rust, zero additional dependencies.

**Why not BTreeMap:** Sorts lexicographically, not topologically. Wrong ordering.

### 2. Single-pass generation

**Choice:** One iteration over components, writing base/variants/compounds/states fragments simultaneously.

**Why:** Current code does 4 passes (`generate_layer_content_slice` per `LayerKind`), 3/4 are no-ops per component each pass. Single pass eliminates redundant iteration. Each component's fragment gets its own `String::with_capacity(512)` — at ~400 bytes average fragment, this avoids most reallocs.

### 3. Serialization: flattened per-component shape

**Choice:** `HashMap<String, PerComponentSheets>` in the manifest JSON, with `#[serde(skip_serializing_if = "Option::is_none")]` on each layer field.

```rust
#[derive(Serialize)]
pub struct PerComponentSheets {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variants: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compounds: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub states: Option<String>,
}
```

**Why not 4 separate HashMaps:** Duplicates component_id keys 4x in JSON output. With 196 components at ~40 bytes per key, that's ~23 KB wasted per redundant copy. Flattened shape matches JS-side access pattern (lookup by component_id, get all layers).

### 4. CssSheets derived from fragments

**Choice:** `CssSheets` fields computed by concatenating fragment vecs with pre-allocated `String::with_capacity(total_bytes)`.

Cumulative byte count tracked during fragment insertion. Concatenation is a zero-realloc fold. `CssSheets` remains the primary consumption path for consumers that don't need fragments — no breaking change.

### 5. Reverse adjacency for invalidation

**Choice:** Build `FxHashMap<String, Vec<String>>` mapping `parent_id → [child_ids]` from the existing `provenance` map (which stores `child → [ancestors]`).

On file change, invalidate all components from the changed file, then BFS through reverse adjacency to collect transitive descendants. Complexity: O(V+E) where V = invalidated components, E = extension edges. Typical tree depth: 2-5 levels.

### 6. Next-plugin incremental HMR

**Choice:** Adopt the vite-plugin's `buildFileEntriesFromCache` pattern — on watch update, send empty source for cache-hit files, full source only for changed files.

Current next-plugin reads ALL files on every `handleWatchUpdate`. This sends redundant data across the NAPI boundary. The Rust-side content-hash cache already handles skipping unchanged files.

## Risks / Trade-offs

- **[Manifest size increase]** → ~59 KB at showcase scale, ~295 KB at 1000 components. All in-process memory. Mitigated by `skip_serializing_if` on empty fragments. Acceptable overhead for the incremental capability gained.
- **[Ordering sensitivity]** → CSS cascade correctness depends on fragment insertion order matching `reconciled_order`. Mitigated by using Vec (ordered) not HashMap (unordered), with explicit test asserting fragment concatenation equals existing CssSheets output.
- **[Extension chain invalidation latency]** → Deep extension chains (5+ levels) could cascade invalidation across many files. Mitigated: typical depth is 2-3. The BFS is O(k) where k is small. Monitor via verbose timing.
- **[Backward compatibility]** → `CssSheets` stays. `manifest.css` stays. Fragments are a new additive field. Zero breaking changes.
