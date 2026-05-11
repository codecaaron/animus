## MODIFIED Requirements

### Requirement: Incremental re-analysis on file change
In dev mode, the extraction pipeline SHALL run via the existing singleton deduplication (one instance executes, others await). After CSS is assembled, it SHALL be stored in the shared variable. Disk writes after CSS changes SHALL serve as HMR triggers. `processAssets` SHALL ensure all compilers deliver correct CSS regardless of which instance ran the pipeline.

#### Scenario: Component file changed
- **WHEN** a source file containing builder chain components is modified during dev
- **THEN** the owning instance SHALL re-run `analyzeProject()` with updated file entries
- **AND** store the new CSS in the shared variable
- **AND** write to disk to trigger webpack recompilation
- **AND** the recompilation's `processAssets` SHALL inject the updated CSS

#### Scenario: Non-component file changed
- **WHEN** a source file with no extractable components is modified during dev
- **THEN** the plugin SHALL skip re-analysis (content hash check shows no manifest-relevant change)

#### Scenario: CSS content unchanged after re-analysis
- **WHEN** re-analysis produces identical CSS (same content hash)
- **THEN** no disk write SHALL occur and no recompilation SHALL be triggered

### Requirement: Geological reset on system file change
The plugin SHALL detect changes to the system file and trigger a full reload — cache clear, system reload, and complete re-analysis. The new CSS SHALL be stored in the shared variable and written to disk for HMR.

#### Scenario: System file modified
- **WHEN** the system file (e.g., `src/ds.ts`) is modified during dev
- **THEN** the plugin SHALL call `clearAnalysisCache()`, re-run `loadSystem()`, re-run `analyzeProject()` with fresh config, store new CSS in the shared variable, and write to disk

#### Scenario: Theme token change
- **WHEN** the theme tokens or color scales change
- **THEN** the geological reset SHALL produce updated variable CSS, stored in the shared variable and written to disk for HMR
