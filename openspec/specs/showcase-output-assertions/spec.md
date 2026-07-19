## Purpose

Post-build assertions SHALL validate that the showcase Vite build emits correctly-layered extraction CSS, resolved variable references, and no runtime CSS-in-JS dependencies. Assertions run against built output (not source) and use shared structural utilities from `@animus-ui/assertions` so layer ordering is checked via character-position comparison — the same code that validates the Next.js and Vite consumer fixtures.

## Requirements

### Requirement: Showcase build output contains valid extraction CSS

After the showcase Vite build completes, the output CSS SHALL be validated using structural position-aware assertions, not shell `grep`. The assertion script SHALL use shared utilities from `@animus-ui/assertions`.

#### Scenario: CSS file exists and is non-empty

- **WHEN** `bun run test:showcase` completes
- **THEN** at least one `.css` file SHALL exist in `packages/showcase/dist/assets/`
- **AND** the file SHALL be non-empty

#### Scenario: CSS layer ordering is structurally correct

- **WHEN** the showcase CSS output is inspected
- **THEN** `@layer` declaration SHALL precede `:root` variables
- **AND** `:root` variables SHALL precede `@layer anm-global`
- **AND** `@layer anm-global` SHALL precede `@layer anm-base`
- **AND** layer positions SHALL be validated via character position comparison (not string containment)

#### Scenario: No unresolved transform placeholders

- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL NOT contain `__TRANSFORM__` strings

#### Scenario: Variable CSS present

- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL contain `:root {` indicating CSS variable declarations were emitted

#### Scenario: Component class names present

- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL contain `animus-` prefixed class names

### Requirement: Showcase JS bundle has no runtime CSS dependencies

The showcase JS output SHALL NOT import Emotion or other runtime CSS-in-JS libraries.

#### Scenario: No Emotion imports in JS bundle

- **WHEN** the showcase JS output files are inspected
- **THEN** no file SHALL contain `@emotion` import references

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
