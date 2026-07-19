## ADDED Requirements

### Requirement: Verified tarballs are published unchanged

The release job SHALL materialize package versions and native payloads before packed verification and SHALL publish the same tarball files that pass that verification.

#### Scenario: Release artifacts pass packed verification

- **WHEN** release-time tarballs complete packed verification
- **THEN** each npm publish command receives one of those verified tarball paths

#### Scenario: Release content changes after verification

- **WHEN** a package would need to be repacked or mutated after packed verification
- **THEN** the release job exits non-zero before publishing any affected package

### Requirement: Worker consumer release gate

The release job SHALL require successful showcase, Vite, Vinext, and React Router Worker build, assertion, and credential-free dry-run checks from the same workflow run.

#### Scenario: Supported Worker consumer fails

- **WHEN** any supported Worker consumer build, assertion, or dry-run check fails
- **THEN** the release job does not start and no package is published

#### Scenario: Worker matrix succeeds

- **WHEN** every supported Worker consumer check succeeds
- **THEN** the Worker matrix requirement permits the release job to start

