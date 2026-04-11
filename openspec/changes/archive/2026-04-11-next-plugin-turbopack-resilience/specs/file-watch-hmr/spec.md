## ADDED Requirements

### Requirement: Independent file watcher for dev mode
In dev mode, the plugin SHALL spawn an independent file watcher (chokidar) that monitors source files for changes, decoupled from the bundler's watch mechanism.

#### Scenario: Source file changes in dev
- **WHEN** a developer modifies a component file during `next dev`
- **THEN** the file watcher SHALL detect the change, re-run `analyzeProject()`, and rewrite `.animus/styles.css` if the output changed

#### Scenario: CSS file unchanged after re-analysis
- **WHEN** a file change is detected but `analyzeProject()` produces identical CSS output (content-hash match)
- **THEN** `.animus/styles.css` SHALL NOT be rewritten, preventing unnecessary hot reloads

#### Scenario: System file geological reset
- **WHEN** the system file (`ds.ts`) changes during dev
- **THEN** the watcher SHALL trigger a full pipeline reset: reload system config, re-run analysis, rewrite all outputs

### Requirement: Watcher cleanup on process exit
The file watcher SHALL be stopped and cleaned up when the dev server process exits.

#### Scenario: Dev server terminated
- **WHEN** the user stops `next dev` via SIGINT or SIGTERM
- **THEN** the chokidar watcher SHALL be closed to prevent orphaned file handles
