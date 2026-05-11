## ADDED Requirements

### Requirement: cssSplitting option
The Vite plugin SHALL accept a `cssSplitting` option (default: `false`). When enabled, the plugin SHALL emit a global CSS chunk via the existing virtual module and per-route CSS chunks via Rollup's `emitFile` API in the `generateBundle` hook.

#### Scenario: Option disabled (default)
- **WHEN** `cssSplitting` is not set or set to `false`
- **THEN** the plugin SHALL emit a single virtual CSS module containing all styles, identical to current behavior

#### Scenario: Option enabled
- **WHEN** `cssSplitting: true` is configured
- **THEN** the plugin SHALL emit a global CSS chunk (declaration + variables + globals + system) via the virtual module AND per-route CSS assets via `emitFile`

#### Scenario: Option with hoisting config
- **WHEN** `cssSplitting: { hoistThreshold: 3 }` is configured
- **THEN** the plugin SHALL use 3 as the shared component hoisting threshold

### Requirement: Route chunk association via Rollup chunk graph
The plugin SHALL use Rollup's `generateBundle` hook to inspect the chunk graph, determine which components are in which output chunks, and group per-component CSS accordingly.

#### Scenario: Route chunk maps to component CSS
- **WHEN** Rollup output chunk `Dashboard-abc123.js` contains modules that import components `Table` and `Chart`
- **THEN** the plugin SHALL emit a CSS asset `Dashboard-abc123.css` containing the component CSS for `Table` and `Chart`

#### Scenario: Entry chunk gets no component CSS
- **WHEN** the entry chunk imports only the root layout (which imports `virtual:animus/styles.css`)
- **THEN** the entry chunk's CSS SHALL be the global chunk only — no component CSS unless those components are hoisted
