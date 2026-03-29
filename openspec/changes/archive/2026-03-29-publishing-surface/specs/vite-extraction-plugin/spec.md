## ADDED Requirements

### Requirement: Configurable runtime package
The Vite plugin SHALL accept a `runtime` option (string) that controls which package the transformed source imports `createComponent` from. The default value SHALL be `'@animus-ui/react'`.

#### Scenario: Default runtime import
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts' })` with no `runtime` option
- **THEN** transformed source SHALL contain `import { createComponent } from '@animus-ui/react'`

#### Scenario: Custom runtime import
- **WHEN** consumer configures `animusExtract({ system: './src/ds.ts', runtime: '@animus-ui/vue' })`
- **THEN** transformed source SHALL contain `import { createComponent } from '@animus-ui/vue'`

#### Scenario: Runtime option is a string
- **WHEN** consumer sets `runtime` to any valid npm package name
- **THEN** the plugin SHALL use that string as-is in the generated import statement

## REMOVED Requirements

### Requirement: Prop config serialization
**Reason:** The `config-serializer.ts` file imports from `@animus-ui/core` to build a `TRANSFORM_MAP` and serialize prop config. This is replaced by `ds.serialize().propConfig` and `ds.serialize().transforms` from the system package. The system's serialization provides the same data without requiring a core dependency.
**Migration:** Remove `config-serializer.ts`. Use `serialize().propConfig` (already JSON) and `serialize().transforms` (already a function map) from the system load subprocess.

### Requirement: Transform registry built from config
**Reason:** The `resolve-transforms.ts` file imports all prop groups from `@animus-ui/core` to build a transform registry. This is replaced by `ds.serialize().transforms` from the system package, which already collects all transform functions (including custom transforms from `.withProperties()`).
**Migration:** Remove `resolve-transforms.ts`. Use the in-memory transform registry from `serialize().transforms`. The global styles subprocess (`resolve-global-styles.ts`) already uses this pattern.
