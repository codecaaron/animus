## MODIFIED Requirements

### Requirement: Assertion script is TypeScript

The showcase assertion implementation SHALL remain TypeScript and SHALL be invoked by the showcase package-owned assertion diagnostic through the shared fail-loud owner helper.

#### Scenario: Shared helper invokes TypeScript assertion

- **WHEN** a developer runs `vp run @animus-ui/showcase#verify:assert`
- **THEN** the TypeScript showcase assertion executes after output and assertion-package preconditions pass

### Requirement: Showcase post-build assertion validates keyframes extraction

The showcase package-owned assertion diagnostic and complete owner claim SHALL validate keyframe emission and animation-name integrity.

#### Scenario: Assertion script imports and invokes the helper

- **WHEN** `scripts/assert-showcase-build.ts` is inspected
- **THEN** it SHALL import `assertKeyframesExtracted` from `@animus-ui/assertions`
- **AND** it SHALL call `assertKeyframesExtracted(css, { insideLayer: 'anm-global' })` against the concatenated showcase CSS output

#### Scenario: Build failure when showcase CSS loses keyframe emission

- **WHEN** `vp run @animus-ui/showcase#verify` produces CSS without expected `@keyframes animus-kf-<hash>` blocks
- **THEN** the owner claim exits non-zero with assertion evidence

#### Scenario: Build failure when showcase CSS exhibits px mangling on keyframe refs

- **WHEN** the showcase assertion observes a unit-mangled keyframe reference
- **THEN** the package-owned assertion diagnostic exits non-zero
