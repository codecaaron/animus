## Why

Animus verification can currently pass while testing a different package graph,
artifact, engine route, served asset root, or suppression state from the one it
claims to certify. These gaps are executable today and can permit broken
releases or false-green local/CI results. Hardening the owner boundaries now
makes the existing verification investment trustworthy without adding another
ceremonial policy layer.

## What Changes

- Verify and publish one immutable, release-materialized tarball set.
- Remove dependency-masking packed-install overrides and validate the complete internal graph.
- Gate release on the supported Worker consumer matrix.
- Replace inferred engine receipts with build-observed engine identity.
- Include all active TypeScript tests and assert served-client Worker CSS separately.
- Resolve NAPI freshness against the host loader target.
- Fail closed on risky hygiene deletion and broad Rust/type/dependency suppressions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `packed-consumer-verification`: verify exact tarballs and their unmasked internal dependency closure.
- `release-workflow`: publish the verified tarballs and require supported Worker consumers.
- `verification-tier-policy`: include active tests, host-native freshness, and bounded Rust dependency/lint enforcement.
- `dual-engine-build`: require runtime-observed engine identity in lane receipts.
- `code-hygiene`: stop after risky whole-file deletion without behavior proof.
- `vinext-extraction-canary`: assert CSS beneath the served client root.
- `react-router-extraction-canary`: assert CSS beneath the served client root.

## Impact

Affected surfaces include the release workflow, Vite+ task graph, packed
consumer fixture and verification script, Worker assertions and CI wiring,
NAPI preconditions, engine adapters/receipts, Rust hygiene/Clippy policy, attw
type linting, code-hygiene verdicts, and their owning OpenSpec requirements.
No public runtime API change is intended.
