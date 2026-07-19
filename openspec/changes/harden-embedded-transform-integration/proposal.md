## Why

The named-transform integration test can pass without exercising a transform,
and its shared helper still post-processes legacy placeholders that current
consumer plugins would not resolve. Correcting the test oracle and governing
capability makes the suite honest evidence for embedded Rust evaluation.

## What Changes

- Make the real transform fixture produce a discriminating embedded-evaluation result.
- Replace the conditional placeholder test with unconditional Rust-output assertions.
- Align the shared integration helper and local test documentation with current plugin behavior.
- Update the existing pipeline integration requirement through a delta spec and correct its canonical normative Purpose.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-integration-testing`: require the full integration path and named-transform scenario to prove embedded Rust evaluation rather than TypeScript placeholder resolution.

## Impact

Affected surfaces are `packages/_integration/__tests__/extraction.test.ts`,
`packages/_integration/__tests__/run-pipeline.ts`, the paired transform fixture,
its local `CLAUDE.md`, and the `pipeline-integration-testing` capability. There
are no production API, dependency, Rust, build, or deployment changes. The
canonical Purpose is included explicitly because archive merging preserves it.
