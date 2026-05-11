## MODIFIED Requirements

### Requirement: Bundle size
The runtime shim package (`@animus-ui/react`) SHALL be less than 1KB gzipped, excluding React as a peer dependency.

#### Scenario: Measure bundle size
- **WHEN** the runtime package is built and gzip-compressed
- **THEN** the compressed size SHALL be under 1024 bytes

## ADDED Requirements

### Requirement: Package identity
The React runtime shim SHALL be published as `@animus-ui/react` (not `@animus-ui/runtime`). The package directory SHALL be `packages/react/`.

#### Scenario: Package name
- **WHEN** the package.json is inspected
- **THEN** the `name` field SHALL be `@animus-ui/react`

#### Scenario: Import path in extracted source
- **WHEN** the extraction pipeline transforms a source file
- **THEN** the generated import SHALL be `import { createComponent } from '@animus-ui/react'` (or the value of the plugin's `runtime` option)
