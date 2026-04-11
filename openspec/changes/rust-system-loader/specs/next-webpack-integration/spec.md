## MODIFIED Requirements

### Requirement: Runtime-agnostic subprocess execution
The subprocess model SHALL be replaced by direct NAPI calls for system loading. The `loadSystemModule()` NAPI function handles system module loading internally via OXC + rquickjs — no subprocess or external runtime detection needed for this path. Subprocess execution MAY be retained for other purposes if needed.

#### Scenario: System loading via NAPI
- **WHEN** the next-plugin needs to load the system module during `runFullPipeline()`
- **THEN** it SHALL call `loadSystemModule(systemPath, rootDir)` from `@animus-ui/extract` and use the returned `SystemConfig` fields directly

#### Scenario: No runtime detection for system loading
- **WHEN** `loadSystemModule()` is used for system loading
- **THEN** no `bun` or `node` runtime detection SHALL be required — execution happens in-process via the NAPI binary
