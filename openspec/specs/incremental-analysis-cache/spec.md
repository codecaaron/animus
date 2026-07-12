## Purpose

Requirements for the `incremental-analysis-cache` capability: Per-file extraction cache; Cached entries populate the evaluated working map; Cache stores owned data types; and 2 more.

## Requirements

### Requirement: Per-file extraction cache

The Rust crate SHALL maintain a persistent in-memory cache of per-file extraction results between `analyzeProject()` calls. The cache key SHALL be the tuple `(file_path, content_hash)`. When a file's content hash matches its cached entry, the cached extraction results (FileModuleInfo, ChainDescriptors, ComponentCss) SHALL be reused without re-parsing via OXC.

#### Scenario: Unchanged file reuses cache

- **WHEN** `analyzeProject()` is called with a file entry whose `hash` field matches the cached hash for that path
- **THEN** the file's source is NOT re-parsed via OXC, and cached FileModuleInfo, ChainDescriptors, and ComponentCss are used for subsequent analysis phases

#### Scenario: Changed file invalidates cache

- **WHEN** `analyzeProject()` is called with a file entry whose `hash` field differs from the cached hash (or no cache exists for that path)
- **THEN** the file is re-parsed via OXC, new extraction results replace the cached entry, and the new results are used for subsequent analysis phases

#### Scenario: Removed file evicts cache

- **WHEN** `analyzeProject()` is called without a file entry that existed in a previous call's cache
- **THEN** the cached entry for that file path is evicted

#### Scenario: No hash provided (backward compatibility)

- **WHEN** a file entry has no `hash` field (or `hash` is null)
- **THEN** the file is always re-parsed, and no cache lookup or update occurs for that entry

---

### Requirement: Cached entries populate the evaluated working map

When a file's extraction results are served from cache, the cached evaluation entries (ComponentCss, ComponentReplacement, active props, prop config) SHALL be inserted into the `evaluated` working HashMap used by downstream phases. Extension merging, system_props population, and manifest generation SHALL operate on cached entries identically to freshly-processed entries.

#### Scenario: Extension chain with cached parent

- **WHEN** parent component `Anchor` is unchanged (cache hit) and child component `NavLink` is changed (cache miss)
- **THEN** `Anchor`'s cached evaluation entry is in `evaluated`, and `NavLink`'s merge phase reads `Anchor`'s cached ComponentCss for merging — producing correct merged CSS

#### Scenario: System props on cached component

- **WHEN** component `Button` is unchanged (cache hit) and has active system props from JSX usage
- **THEN** `Button`'s cached ComponentReplacement is in `evaluated`, and Phase 5c populates system_props correctly on the cached entry

---

### Requirement: Cache stores owned data types

Cached extraction results SHALL use owned Rust types (String, Vec, HashMap) that are independent of OXC arena allocators. The cache SHALL NOT hold references to arena-allocated AST nodes. Arena allocators SHALL drop normally after parsing completes.

#### Scenario: Arena drops after cached extraction

- **WHEN** a file is parsed and its extraction results are cached
- **THEN** the OXC `Allocator` used for parsing that file is dropped after extraction completes, and cached data remains valid and accessible

---

### Requirement: ComponentCss equality comparison

ComponentCss and its nested types SHALL implement `PartialEq` to enable structural comparison between cached and freshly-extracted results. When a re-parsed file produces ComponentCss identical to the cached version, CSS regeneration MAY be skipped for that file's contribution.

#### Scenario: Style-unchanged file detected

- **WHEN** a file is re-parsed (content hash changed) but its ComponentCss results are structurally equal to the cached ComponentCss
- **THEN** the system detects this as a "styles unchanged" condition (early-exit Layer 1)

---

### Requirement: Cache cleared on geological reset

When a geological reset occurs (theme, config, or system file change), the entire per-file cache SHALL be cleared, forcing full re-parsing of all files on the next `analyzeProject()` call.

#### Scenario: Theme change clears cache

- **WHEN** the theme, config, or system file changes triggering a geological reset
- **THEN** the per-file extraction cache is fully cleared before the next analysis
