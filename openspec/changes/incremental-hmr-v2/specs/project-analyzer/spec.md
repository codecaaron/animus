## MODIFIED Requirements

### Requirement: FileEntry accepts optional content hash

The `FileEntry` input structure SHALL accept an optional `hash` field (string or null). When present, the hash is used for cache lookup. When absent, the file is always re-parsed.

#### Scenario: Hash field present
- **WHEN** a FileEntry includes `{ path: "src/Button.tsx", source: "...", hash: "abc123" }`
- **THEN** the analyzer checks the per-file cache for path "src/Button.tsx" with hash "abc123"

#### Scenario: Hash field absent
- **WHEN** a FileEntry includes `{ path: "src/Button.tsx", source: "..." }` with no hash field
- **THEN** the file is re-parsed unconditionally (backward-compatible behavior)

---

### Requirement: analyzeProject accepts dev_mode parameter

The `analyzeProject()` NAPI function SHALL accept an optional `dev_mode` boolean parameter. When `true`, JSX scanning runs ONLY on changed files (cache misses), cached scan results are reused for unchanged files, and reconciliation is skipped entirely. When `false` or absent, full analysis proceeds unchanged (all files scanned, reconciliation applied).

#### Scenario: Dev-mode parameter passed
- **WHEN** `analyzeProject()` is called with `dev_mode: true`
- **THEN** JSX scanning runs only on changed files (cache misses), cached scan results are merged for unchanged files, and reconciliation is skipped

#### Scenario: Dev-mode parameter absent
- **WHEN** `analyzeProject()` is called without a `dev_mode` parameter
- **THEN** the analysis runs all phases including full JSX scanning (all files) and reconciliation (unchanged from current behavior)

---

### Requirement: Manifest output identical for cached vs uncached analysis

Given identical file inputs, `analyzeProject()` SHALL produce the same manifest regardless of whether per-file extraction results were served from cache or freshly parsed. The cache SHALL NOT introduce divergence in component ordering, CSS output, or extension merging.

#### Scenario: Cached result matches full analysis
- **WHEN** `analyzeProject()` is called twice with the same file inputs — first without cache, second with cache populated from the first call
- **THEN** the manifest JSON output of both calls is byte-identical
