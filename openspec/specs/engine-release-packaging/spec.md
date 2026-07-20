## Purpose

Defines requirements for the `engine-release-packaging` capability.
## Requirements
### Requirement: Missing v2 engine binaries fail loud

Loading the v2 engine when its platform binary is absent SHALL raise an actionable error naming the missing binary and the build command; it SHALL NOT fall back to any other code path.

#### Scenario: v2 binary absent at load

- **WHEN** the package root entry (or the `./engine-v2` alias) is required on a platform whose v2 binary is not present
- **THEN** the loader SHALL throw an error naming the expected binary file and remediation, and no fallback SHALL be substituted

### Requirement: Published package carries the v2 engine binaries

The published `@animus-ui/extract` npm package SHALL include the v2 NAPI binary for every supported platform target, and both the package root entry and the `./engine-v2` alias SHALL resolve to a loadable module from the packed artifact. No v1 binary, loader, or platform sub-package SHALL be built, packed, or published.

#### Scenario: Postpack smoke gates the release

- **WHEN** the package is packed for release with `--expect-full-matrix`
- **THEN** the extracted tarball SHALL contain all three supported targets' v2 binaries, requiring the loader SHALL succeed, and a failure SHALL block publication

#### Scenario: No v1 distribution artifacts

- **WHEN** the release job assembles the immutable bundle
- **THEN** no `@animus-ui/extract-<platform>` platform package is generated, packed, or published, and the main package declares no optionalDependencies on them

