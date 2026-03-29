## ADDED Requirements

### Requirement: Platform package generation
The release job SHALL download all NAPI binary artifacts and run `napi pre-publish -t npm` to generate synthetic per-platform npm packages.

#### Scenario: All platform artifacts downloaded
- **WHEN** the release job starts
- **THEN** it SHALL download artifacts for all 3 targets (aarch64-apple-darwin, x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu) into `packages/extract/`

#### Scenario: Synthetic packages generated
- **WHEN** `napi pre-publish -t npm` runs in `packages/extract/`
- **THEN** it SHALL produce directories under `npm/` for each target, each containing a `package.json` with `os`, `cpu`, and `main` fields pointing to the `.node` binary

### Requirement: Platform packages published before main package
The release job SHALL publish all platform-specific packages to npm before publishing the main `@animus-ui/extract` package.

#### Scenario: Publish order enforced
- **WHEN** the release job publishes packages
- **THEN** `@animus-ui/extract-darwin-arm64`, `@animus-ui/extract-linux-x64-gnu`, and `@animus-ui/extract-linux-arm64-gnu` SHALL be published before `@animus-ui/extract`

#### Scenario: Platform package version matches main
- **WHEN** platform packages are generated
- **THEN** each platform package version SHALL match the version in `packages/extract/package.json`

### Requirement: NPM authentication
The release job SHALL authenticate to npm using the `NPM_TOKEN` repository secret.

#### Scenario: Token configured
- **WHEN** the release job runs npm publish commands
- **THEN** it SHALL use the `NPM_TOKEN` secret via `.npmrc` or `--token` flag

#### Scenario: Token missing
- **WHEN** the `NPM_TOKEN` secret is not set
- **THEN** the release job SHALL fail with a clear error before attempting any publish
