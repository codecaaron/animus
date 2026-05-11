## ADDED Requirements

### Requirement: Dev-mode CSS regeneration
In Next.js development mode, the webpack plugin SHALL watch for source file changes and regenerate the CSS output file when components change.

#### Scenario: Component file changed
- **WHEN** a source file containing Animus components is saved during `next dev`
- **THEN** the plugin SHALL re-run `analyze_project()` with the updated file, regenerate `.animus/styles.css`, and webpack's built-in file watching SHALL trigger a hot update for the CSS import

#### Scenario: Non-component file changed
- **WHEN** a source file with no Animus components is saved
- **THEN** the plugin SHALL NOT re-run analysis (the manifest is unchanged)

#### Scenario: Content-hash skip
- **WHEN** a file is saved but its content hash matches the previously cached value
- **THEN** the plugin SHALL skip re-analysis for that file

### Requirement: Geological reset detection
The plugin SHALL detect changes to the system definition file and trigger a full re-analysis with subprocess reload.

#### Scenario: System file changed
- **WHEN** the system definition file (the `system` option path) is modified during dev
- **THEN** the plugin SHALL reload the system via bun subprocess, re-run full project analysis, and regenerate the CSS file

#### Scenario: Non-system file uses cached system
- **WHEN** a component file changes but the system file is unchanged
- **THEN** the plugin SHALL reuse the cached system config (tokens, propConfig, groupRegistry, transforms) without invoking a subprocess

### Requirement: Extraction diagnostics in dev
The plugin SHALL print extraction diagnostics (bail and skip warnings) to the console during dev-mode re-analysis, matching the Vite plugin's always-on diagnostic output.

#### Scenario: Bail warning on re-analysis
- **WHEN** re-analysis produces a diagnostic with `kind: "bail"`
- **THEN** the plugin SHALL print `[animus] ⚠ <component> not extracted: <message>` to the console

#### Scenario: Skip warning on re-analysis
- **WHEN** re-analysis produces a diagnostic with `kind: "skip"`
- **THEN** the plugin SHALL print `[animus] ⚠ <component>: skipped <message>` to the console
