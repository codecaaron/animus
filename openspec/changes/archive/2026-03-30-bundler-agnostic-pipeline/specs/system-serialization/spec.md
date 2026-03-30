## ADDED Requirements

### Requirement: SerializedConfig type exported from pipeline subpath
The `SerializedConfig` type (already defined in SystemBuilder.ts) SHALL be re-exported from `@animus-ui/system/pipeline` for build tooling consumers.

#### Scenario: SerializedConfig importable from pipeline
- **WHEN** build tooling imports `SerializedConfig` from `@animus-ui/system/pipeline`
- **THEN** it SHALL receive the type `{ propConfig: string; groupRegistry: string; transforms: Record<string, NamedTransform> }`
