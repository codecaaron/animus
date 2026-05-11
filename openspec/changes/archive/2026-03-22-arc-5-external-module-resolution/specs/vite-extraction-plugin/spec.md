## MODIFIED Requirements

### Requirement: Package import discovery and resolution
The Vite plugin SHALL discover package-name imports in the analyzed source files, resolve them using Vite's `this.resolve()` API, include the resolved package source files in the analysis, and pass a package resolution map to `analyze_project`.

#### Scenario: Discover animus package imports
- **WHEN** source files contain `import { Box } from '@animus-ui/components'`
- **AND** `packagePatterns` includes `@animus-ui/*`
- **THEN** the plugin SHALL detect the package specifier `@animus-ui/components` as requiring resolution

#### Scenario: Resolve package to entry file
- **WHEN** the plugin discovers `@animus-ui/components` needs resolution
- **THEN** it SHALL call `this.resolve('@animus-ui/components')` to get the absolute file path of the package entry, and record the mapping

#### Scenario: Include package source tree
- **WHEN** `@animus-ui/components` resolves to `packages/ui/src/index.ts`
- **THEN** the plugin SHALL discover all `.ts`/`.tsx` files in `packages/ui/src/` and include them in the file entries passed to `analyze_project`

#### Scenario: Pass resolution map to analyzer
- **WHEN** the plugin has resolved package specifiers
- **THEN** it SHALL call `analyzeProject(fileEntriesJson, themeJson, configJson, groupRegistryJson, packageResolutionJson)` with the resolution map as the 5th argument

#### Scenario: Custom package patterns
- **WHEN** `animusExtract({ packagePatterns: ['@mydesign/*'] })` is configured
- **THEN** the plugin SHALL resolve imports matching `@mydesign/*` instead of the default `@animus-ui/*`

#### Scenario: External packages ignored
- **WHEN** source files import from `react`, `next/link`, or other packages NOT matching the configured patterns
- **THEN** the plugin SHALL NOT attempt to resolve those imports — they are external

### Requirement: Plugin options for package resolution
The `AnimusExtractOptions` interface SHALL include a `packagePatterns` field (type: `string[]`, default: `['@animus-ui/*']`) that controls which package imports trigger resolution.

#### Scenario: Default patterns
- **WHEN** `animusExtract()` is called with no `packagePatterns` option
- **THEN** the plugin SHALL use `['@animus-ui/*']` as the default pattern set

#### Scenario: Override patterns
- **WHEN** `animusExtract({ packagePatterns: ['@mydesign/*', '@myutil/*'] })` is called
- **THEN** only imports matching `@mydesign/*` or `@myutil/*` SHALL be resolved
