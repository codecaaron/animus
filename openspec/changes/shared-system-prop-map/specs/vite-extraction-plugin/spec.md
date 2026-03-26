## ADDED Requirements

### Requirement: System prop map virtual module
The Vite plugin SHALL serve a virtual module at `virtual:animus/system-props` that exports the shared system prop map. The module SHALL be generated from the `system_prop_map` artifact returned by the Rust extraction pipeline.

#### Scenario: Resolve virtual module ID
- **WHEN** a source file imports `from 'virtual:animus/system-props'`
- **THEN** the plugin's `resolveId` hook SHALL resolve it to an internal virtual module ID (e.g., `\0virtual:animus/system-props`)

#### Scenario: Load virtual module content
- **WHEN** the resolved virtual module ID is loaded
- **THEN** the plugin's `load` hook SHALL return `export const systemPropMap = <JSON>;` where `<JSON>` is the system prop map from the extraction result

#### Scenario: Module available during dev
- **WHEN** the Vite dev server is running
- **THEN** `virtual:animus/system-props` SHALL be resolvable and serve the current map from the most recent extraction

#### Scenario: Module available during build
- **WHEN** `vite build` runs in production mode
- **THEN** `virtual:animus/system-props` SHALL be resolvable and serve the map from the full-project extraction

### Requirement: System prop map HMR invalidation
During dev mode, the plugin SHALL invalidate the `virtual:animus/system-props` module ONLY when the system prop map content changes between extraction runs.

#### Scenario: Map changed after file edit
- **WHEN** a file edit causes re-extraction and the resulting system prop map differs from the cached version
- **THEN** the plugin SHALL invalidate the `virtual:animus/system-props` module in Vite's module graph, triggering HMR for all importing modules

#### Scenario: Map unchanged after file edit
- **WHEN** a file edit causes re-extraction but the system prop map is identical to the cached version
- **THEN** the plugin SHALL NOT invalidate the `virtual:animus/system-props` module — no unnecessary HMR propagation

#### Scenario: Geological reset invalidates map
- **WHEN** the system definition file changes (triggering a full geological reset with theme/scale reload)
- **THEN** the plugin SHALL re-extract, generate a new system prop map, and invalidate the virtual module if the map changed
