# engine-release-packaging

## ADDED Requirements

### Requirement: Published package carries both engine binaries
The published `@animus-ui/extract` npm package SHALL include the v2 NAPI binary alongside the v1 binary for every supported platform target, and the `./engine-v2` export SHALL resolve to a loadable module from the packed artifact.

#### Scenario: Postpack smoke gates the release
- **WHEN** the package is packed for release
- **THEN** requiring both `index.js` and `index-v2.js` from the extracted tarball SHALL succeed, and a failure SHALL block publication

### Requirement: Missing v2 engine binaries fail loud
Loading the V2 engine export when its platform binary is absent SHALL raise an actionable error naming the missing binary and the build command; it SHALL NOT fall back to the V1 engine silently.

#### Scenario: v2 binary absent at load
- **WHEN** `./engine-v2` is required on a platform whose v2 binary is not present
- **THEN** the loader SHALL throw an error naming the expected binary file and remediation, and no v1 code path SHALL be substituted
