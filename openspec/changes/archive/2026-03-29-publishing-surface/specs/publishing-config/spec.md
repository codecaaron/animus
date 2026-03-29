## ADDED Requirements

### Requirement: Publishable packages are not private
The packages `@animus-ui/system`, `@animus-ui/react`, `@animus-ui/extract`, and `@animus-ui/vite-plugin` SHALL NOT have `"private": true` in their package.json.

#### Scenario: npm publish succeeds
- **WHEN** `npm publish --tag next --dry-run` is run on any publishable package
- **THEN** npm SHALL NOT reject the publish due to the private field

### Requirement: Publishing metadata on all publishable packages
Each publishable package SHALL include `author`, `license` (MIT), `repository` (with `directory` field pointing to the package path), `homepage`, and `publishConfig` with `"access": "public"`.

#### Scenario: Package metadata is complete
- **WHEN** a publishable package's package.json is inspected
- **THEN** it SHALL contain all required metadata fields with non-empty values

### Requirement: Explicit exports field
Each publishable package SHALL declare an `exports` field mapping `"."` to `{ "types", "import" }` entry points. Packages with subpath exports (e.g., system's `"./groups"`) SHALL declare those as additional entries.

#### Scenario: Main export resolves
- **WHEN** a consumer writes `import { createSystem } from '@animus-ui/system'`
- **THEN** the import SHALL resolve via the `exports["."].import` path

#### Scenario: Subpath export resolves
- **WHEN** a consumer writes `import { space } from '@animus-ui/system/groups'`
- **THEN** the import SHALL resolve via the `exports["./groups"].import` path

### Requirement: Explicit files field
Each publishable package SHALL declare a `files` field limiting the npm tarball to built output only. TS packages SHALL include `["dist"]`. The extract package SHALL include `["index.js", "index.d.ts"]`.

#### Scenario: Tarball contains only dist
- **WHEN** `npm pack` is run on a TS publishable package
- **THEN** the tarball SHALL contain only files in `dist/` plus `package.json` and `README.md`

### Requirement: Version alignment for beta
All publishable packages SHALL use version `0.1.0-next.1` for the initial beta release and SHALL be published with `--tag next`.

#### Scenario: Install via next tag
- **WHEN** a consumer runs `bun add @animus-ui/system@next`
- **THEN** they SHALL receive the `0.1.0-next.1` version

### Requirement: No workspace protocol in published dependencies
Published packages SHALL NOT contain `workspace:*` dependency references. All cross-package dependencies SHALL use real semver ranges.

#### Scenario: Dependencies use version ranges
- **WHEN** a publishable package's package.json is inspected
- **THEN** all `dependencies` and `peerDependencies` SHALL use semver ranges (e.g., `^0.1.0-next.1`), not `workspace:*`
