## MODIFIED Requirements

### Requirement: Root-level verification command

The Next fixture package SHALL own `verify:build`, `verify:assert`, and complete `verify` scripts. The canonical focused command SHALL be `vp run @animus-ui/next-app#verify`; no root Next target family is required.

#### Scenario: Verification command exists

- **WHEN** a developer runs `vp run @animus-ui/next-app#verify`
- **THEN** the fixture performs its fail-loud preflight and production build
- **AND** the post-build TypeScript assertion executes after the build

### Requirement: Post-build assertion validates keyframes extraction

The Next package-owned assertion diagnostic and complete `verify` claim SHALL fail when expected keyframes are absent or animation-name references are unit-mangled.

#### Scenario: Assertion script imports and invokes the helper

- **WHEN** `e2e/next-app/scripts/assert-build.ts` is inspected
- **THEN** it SHALL import `assertKeyframesExtracted` from `@animus-ui/assertions`
- **AND** it SHALL call `assertKeyframesExtracted(css, { insideLayer: 'anm-global', minBlocks: <N>, minReferences: 1 })` where `<N>` matches the fixture's keyframe count

#### Scenario: Build failure when keyframes block is missing

- **WHEN** `vp run @animus-ui/next-app#verify` produces CSS without an expected `@keyframes animus-kf-<hash>` block
- **THEN** the owner claim exits non-zero with the assertion diagnostic visible

#### Scenario: Build failure when animation-name references are mangled with px

- **WHEN** a Next assertion observes a unit-mangled animation-name reference
- **THEN** the package-owned assertion diagnostic exits non-zero
