## ADDED Requirements

### Requirement: Incremental re-analysis on file change
In dev mode (Next.js dev server), the webpack plugin SHALL detect file changes via `compiler.hooks.watchRun` and trigger incremental re-analysis when extractable source files change.

#### Scenario: Component file changed
- **WHEN** a source file containing builder chain components is modified during dev
- **THEN** the plugin SHALL re-run `analyzeProject()` with updated file entries and rewrite `.animus/styles.css` if CSS content changed

#### Scenario: Non-component file changed
- **WHEN** a source file with no extractable components is modified during dev
- **THEN** the plugin SHALL skip re-analysis (content hash check shows no manifest-relevant change)

#### Scenario: CSS file rewrite triggers hot update
- **WHEN** `.animus/styles.css` is rewritten with new content
- **THEN** webpack's file watcher SHALL detect the change and trigger a CSS hot update in the browser

### Requirement: Geological reset on system file change
The plugin SHALL detect changes to the system file (the module passed via `system` option) and trigger a full reload — subprocess re-execution, cache clear, and complete re-analysis.

#### Scenario: System file modified
- **WHEN** the system file (e.g., `src/ds.ts`) is modified during dev
- **THEN** the plugin SHALL call `clearAnalysisCache()`, re-run `loadSystem()` via subprocess, and re-run `analyzeProject()` with fresh config

#### Scenario: Theme token change
- **WHEN** the theme tokens or color scales change (which modifies the system file's serialized output)
- **THEN** the geological reset SHALL produce updated variable CSS in `.animus/styles.css`

### Requirement: Content hash deduplication
The plugin SHALL track content hashes for source files to avoid redundant analysis and CSS writes.

#### Scenario: Unchanged file skipped
- **WHEN** a file's content hash matches the previous analysis pass
- **THEN** the plugin SHALL send an empty source with the hash to `analyzeProject()` (Rust cache-hit path skips re-parse)

#### Scenario: CSS write skipped when unchanged
- **WHEN** resolved CSS content is identical to the existing `.animus/styles.css`
- **THEN** the plugin SHALL NOT rewrite the file (avoids unnecessary webpack recompilation)
