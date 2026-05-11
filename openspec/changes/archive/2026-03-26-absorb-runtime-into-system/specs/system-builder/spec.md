## MODIFIED Requirements

### Requirement: System package exports
The `@animus-ui/system` package SHALL export `createComponent` alongside the existing builder chain, theme construction, and type exports. The package SHALL declare `react` as a peer dependency.

#### Scenario: Package exports include createComponent
- **WHEN** a consumer imports from `@animus-ui/system`
- **THEN** `createComponent` SHALL be available as a named export

#### Scenario: React peer dependency
- **WHEN** `@animus-ui/system` is installed
- **THEN** the package SHALL require `react` as a peer dependency with range `^18.0.0 || ^19.0.0`

#### Scenario: No runtime package dependency
- **WHEN** `@animus-ui/system/package.json` is inspected
- **THEN** `@animus-ui/runtime` SHALL NOT appear in `dependencies` or `peerDependencies`
