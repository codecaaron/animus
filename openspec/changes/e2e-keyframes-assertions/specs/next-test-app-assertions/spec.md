## ADDED Requirements

### Requirement: Post-build assertion validates keyframes extraction

The Next.js post-build assertion script (`e2e/next-app/scripts/assert-build.ts`) SHALL invoke `assertKeyframesExtracted` from `@animus-ui/assertions` against the concatenated CSS output from `.next/`, with `insideLayer: 'anm-global'` and `minBlocks` matching the count of named keyframes declared in the fixture's `animations` collection.

#### Scenario: Assertion script imports and invokes the helper

- **WHEN** `e2e/next-app/scripts/assert-build.ts` is inspected
- **THEN** it SHALL import `assertKeyframesExtracted` from `@animus-ui/assertions`
- **AND** it SHALL call `assertKeyframesExtracted(css, { insideLayer: 'anm-global', minBlocks: <N>, minReferences: 1 })` where `<N>` matches the fixture's keyframe count

#### Scenario: Build failure when keyframes block is missing

- **WHEN** `bun run verify:next` is executed and the build output CSS is missing an expected `@keyframes animus-kf-<hash>` block
- **THEN** `verify:assert:next` SHALL exit with non-zero status
- **AND** the failure message SHALL identify the missing block via `AssertionError.details`

#### Scenario: Build failure when animation-name references are mangled with px

- **WHEN** the build output CSS contains any `animation-name: animus-kf-<hash>px` substring (indicating `UNITLESS_PROPERTIES` regression)
- **THEN** `verify:assert:next` SHALL exit with non-zero status
- **AND** the failure message SHALL identify the mangled value
