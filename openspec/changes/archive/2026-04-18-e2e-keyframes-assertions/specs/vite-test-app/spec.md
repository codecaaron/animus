## ADDED Requirements

### Requirement: Keyframes collection fixture exists in Vite test app

The Vite test app's system module (`e2e/vite-app/src/ds.ts`) SHALL export a named `animations` binding that is the return value of a `keyframes()` call from `@animus-ui/system`. The collection SHALL declare at least two distinct named keyframes with different frame bodies.

#### Scenario: `animations` export is a Keyframes collection

- **WHEN** `e2e/vite-app/src/ds.ts` is inspected
- **THEN** it SHALL `import { keyframes } from '@animus-ui/system'`
- **AND** it SHALL export `animations = keyframes({ <name1>: { ... }, <name2>: { ... } })` where `<name1>` and `<name2>` have different frame bodies

### Requirement: Vite app renders a keyframes-consuming component

`e2e/vite-app/src/App.tsx` SHALL import and render at least one component whose `ds.styles()` declaration includes `animationName: animations.<key>` referencing the fixture's `animations` collection.

#### Scenario: Component consumes a branded keyframe ref

- **WHEN** `e2e/vite-app/src/components/` is inspected
- **THEN** it SHALL contain at least one component file whose `ds.styles({...})` call includes `animationName: animations.<key>` as a literal member expression

#### Scenario: Component is rendered in App.tsx

- **WHEN** `e2e/vite-app/src/App.tsx` is inspected
- **THEN** the keyframes-consuming component SHALL appear in the returned JSX tree

#### Scenario: Component is exported from the components barrel

- **WHEN** `e2e/vite-app/src/components/index.ts` is inspected
- **THEN** the keyframes-consuming component SHALL be re-exported

### Requirement: Post-build assertion validates keyframes extraction

The Vite post-build assertion script (`e2e/vite-app/scripts/assert-build.ts`) SHALL invoke `assertKeyframesExtracted` from `@animus-ui/assertions` against the concatenated CSS output from `dist/`, with `insideLayer: 'anm-global'` and `minBlocks` matching the count of named keyframes declared in the fixture's `animations` collection.

#### Scenario: Assertion script imports and invokes the helper

- **WHEN** `e2e/vite-app/scripts/assert-build.ts` is inspected
- **THEN** it SHALL import `assertKeyframesExtracted` from `@animus-ui/assertions`
- **AND** it SHALL call `assertKeyframesExtracted(css, { insideLayer: 'anm-global', minBlocks: <N>, minReferences: 1 })` where `<N>` matches the fixture's keyframe count

#### Scenario: Build failure when keyframes block is missing

- **WHEN** `bun run verify:vite` is executed and the build output CSS is missing an expected `@keyframes animus-kf-<hash>` block
- **THEN** `verify:assert:vite` SHALL exit with non-zero status
- **AND** the failure message SHALL identify the missing block via `AssertionError.details`

#### Scenario: Build failure when animation-name references are mangled with px

- **WHEN** the build output CSS contains any `animation-name: animus-kf-<hash>px` substring
- **THEN** `verify:assert:vite` SHALL exit with non-zero status
- **AND** the failure message SHALL identify the mangled value
