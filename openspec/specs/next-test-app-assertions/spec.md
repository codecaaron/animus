## Purpose

Post-build assertions SHALL validate that the Next.js consumer fixture (`e2e/next-app/`) correctly exercises the extraction pipeline end-to-end. Assertions run against built output (not source) and use shared structural utilities from `@animus-ui/assertions` so layer ordering, class-name prefixes, and placeholder hygiene are verified by the same code that validates the Vite and showcase consumers.

## Requirements

### Requirement: Post-build assertion script

The test app SHALL include a TypeScript assertion script (replacing the shell script) that validates the Next.js build output for extraction correctness using shared structural assertion utilities. The script SHALL exit with non-zero status on any assertion failure.

#### Scenario: CSS layer ordering is structurally correct

- **WHEN** the build output CSS files are inspected
- **THEN** `@layer` declarations SHALL be validated for correct positional ordering via character position comparison
- **AND** the assertion SHALL verify `@layer anm-base` precedes `@layer anm-variants`

#### Scenario: Class names follow animus pattern

- **WHEN** the build output JS or HTML files are searched
- **THEN** they SHALL contain class names matching the `animus-` prefix pattern

#### Scenario: No Emotion runtime

- **WHEN** the build output JS bundles are searched for `@emotion`
- **THEN** the search SHALL return no matches

#### Scenario: No unresolved transform placeholders

- **WHEN** the build output CSS files are searched for `__TRANSFORM__`
- **THEN** the search SHALL return no matches

#### Scenario: Both routers rendered

- **WHEN** the build output directory is inspected
- **THEN** it SHALL contain output for both App Router pages and Pages Router pages

### Requirement: Root-level verification command

The Next fixture package SHALL own `verify:build`, `verify:assert`, and complete `verify` scripts. The canonical focused command SHALL be `vp run @animus-ui/next-app#verify`; no root Next target family is required.

#### Scenario: Verification command exists

- **WHEN** a developer runs `vp run @animus-ui/next-app#verify`
- **THEN** the fixture performs its fail-loud preflight and production build
- **AND** the post-build TypeScript assertion executes after the build

### Requirement: Assertion script uses shared utilities

The Next.js post-build assertions SHALL import structural assertion utilities from the shared `@animus-ui/assertions` workspace package.

#### Scenario: Shared utility import

- **WHEN** the assertion script is inspected
- **THEN** it SHALL import `assertLayerOrder`, `assertNoPlaceholders`, and `assertClassNameFormat` from `@animus-ui/assertions`

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
