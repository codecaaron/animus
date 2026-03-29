## ADDED Requirements

### Requirement: TS package publish order
The release job SHALL publish TypeScript packages in dependency order to ensure each package's dependencies are available on npm when it is published.

#### Scenario: Dependency-ordered publish
- **WHEN** the release job publishes TS packages
- **THEN** it SHALL publish in this order: core → theming → runtime → system → vite-plugin

#### Scenario: Cross-dependency resolution
- **WHEN** `@animus-ui/system` is published
- **THEN** `@animus-ui/core` and `@animus-ui/theming` SHALL already be available on npm at the declared version

### Requirement: Beta versions on next branch
Tags pushed from the `next` branch SHALL publish with npm dist-tag `next`, not `latest`.

#### Scenario: Beta tag publish
- **WHEN** a tag `v0.1.0-next.1` is pushed
- **THEN** all packages SHALL be published with `--tag next` so that `bun add @animus-ui/system` still installs the latest stable, while `bun add @animus-ui/system@next` installs the beta

#### Scenario: Stable tag publish
- **WHEN** a tag `v0.1.0` (no prerelease suffix) is pushed
- **THEN** all packages SHALL be published with the default `latest` dist-tag

### Requirement: Build before publish
The release job SHALL build all TS packages before publishing to ensure `dist/` directories contain current artifacts.

#### Scenario: Fresh build in release
- **WHEN** the release job prepares to publish TS packages
- **THEN** it SHALL run `bun run build:ts` before any `npm publish` command

### Requirement: Dry run on PR
When triggered by a pull request, the CI SHALL NOT publish but SHALL validate that `npm pack --dry-run` succeeds for each publishable package.

#### Scenario: PR validates pack
- **WHEN** CI runs on a pull request
- **THEN** the `verify` job SHALL run `npm pack --dry-run` on each publishable package directory to verify tarball contents
