## ADDED Requirements

### Requirement: Exact publish artifact verification

The packed consumer lane SHALL accept a prebuilt tarball set and exercise those tarballs without repacking their source directories.

#### Scenario: Prebuilt tarballs are supplied

- **WHEN** the packed consumer lane receives paths for all publishable package tarballs
- **THEN** every lint, install, load, type-check, build, assertion, and receipt step operates on those supplied files
- **AND** the lane does not create replacement tarballs

#### Scenario: Supplied tarball is missing

- **WHEN** a required publishable package tarball is absent from the supplied set
- **THEN** the lane exits non-zero and identifies the missing package

### Requirement: Unmasked internal dependency closure

The packed consumer SHALL install local publishable tarballs without an internal-package override and SHALL validate every installed `@animus-ui/*` package instance against the corresponding tested tarball.

#### Scenario: Embedded internal edge is stale

- **WHEN** a tested tarball embeds an internal dependency version different from the corresponding sibling tarball
- **THEN** packed verification exits non-zero and reports the dependent package, dependency name, expected version, and installed or declared version

#### Scenario: Nested internal package is substituted

- **WHEN** installation produces a nested or registry-sourced internal package instance that does not match the tested tarball version
- **THEN** packed verification exits non-zero and identifies the mismatched installed path

### Requirement: Suppressed type diagnostics remain bounded

The packed type-resolution gate SHALL fail when a new `internal-resolution-error` appears outside the exact accepted DEF-5 diagnostic set.

#### Scenario: Additional declaration resolution failure appears

- **WHEN** properties or system produces an additional internal-resolution diagnostic
- **THEN** the packed lane exits non-zero and reports the additional diagnostic

#### Scenario: Known DEF-5 diagnostics are removed

- **WHEN** declaration output no longer produces the accepted DEF-5 diagnostics
- **THEN** the packed lane exits non-zero until the obsolete exemption is removed

