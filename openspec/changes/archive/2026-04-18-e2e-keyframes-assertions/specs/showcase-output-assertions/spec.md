## ADDED Requirements

### Requirement: Showcase post-build assertion validates keyframes extraction

The showcase post-build assertion script (`scripts/assert-showcase-build.ts`) SHALL invoke `assertKeyframesExtracted` from `@animus-ui/assertions` against the concatenated CSS output from `packages/showcase/dist/`. The showcase already exports an `animations` collection via `packages/showcase/src/ds.ts` (shipped in `rc-channel-graduation` §3B); this requirement adds positional post-build validation of that collection's extracted output.

#### Scenario: Assertion script imports and invokes the helper

- **WHEN** `scripts/assert-showcase-build.ts` is inspected
- **THEN** it SHALL import `assertKeyframesExtracted` from `@animus-ui/assertions`
- **AND** it SHALL call `assertKeyframesExtracted(css, { insideLayer: 'anm-global' })` against the concatenated showcase CSS output

#### Scenario: Build failure when showcase CSS loses keyframe emission

- **WHEN** `bun run verify:showcase` is executed and the showcase output CSS is missing `@keyframes animus-kf-<hash>` blocks (regression in the `@animus-ui/vite-plugin` keyframes discovery path)
- **THEN** `verify:assert:showcase` SHALL exit with non-zero status
- **AND** the failure message SHALL identify the missing blocks via `AssertionError.details`

#### Scenario: Build failure when showcase CSS exhibits px mangling on keyframe refs

- **WHEN** the showcase output CSS contains any `animation-name: animus-kf-<hash>px` substring
- **THEN** `verify:assert:showcase` SHALL exit with non-zero status
- **AND** the failure message SHALL identify the mangled value
