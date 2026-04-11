## MODIFIED Requirements

### Requirement: CSS-only HMR in dev mode
HMR geological reset detection SHALL check the system file (single file) instead of separate config and theme files.

#### Scenario: System file change triggers geological reset
- **WHEN** the system definition file (the `system` option path) changes during dev
- **THEN** the plugin SHALL trigger a full geological reset: reload the system via `loadSystemModule()` NAPI call, rebuild all caches

#### Scenario: Component file change uses cached system
- **WHEN** a non-system file changes during dev
- **THEN** the plugin SHALL use the cached system config (tokens, propConfig, groupRegistry, transforms) — no system reload

## REMOVED Requirements

### Requirement: Global styles resolution via standalone subprocess
**Reason**: Global styles are now resolved Rust-side by the theme_resolver in analyzeProject(). The standalone subprocess was already eliminated in a prior change. Removing the spec to match reality.
**Migration**: No action needed — already removed from implementation.
