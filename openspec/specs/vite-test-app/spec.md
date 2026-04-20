## Purpose

A minimal Vite consumer fixture SHALL live at `e2e/vite-app/` that exercises the extraction pipeline via `@animus-ui/vite-plugin`. It mirrors the `e2e/next-app` pattern: a small set of components importing from `@animus-ui/test-ds`, its own system definition, and post-build structural assertions. The fixture exists to verify the Vite extraction path end-to-end without pulling in docs-site weight.
## Requirements
### Requirement: Contrived Vite test application
A minimal Vite application SHALL exist at `e2e/vite-app/` that exercises the extraction pipeline via `@animus-ui/vite-plugin`. It SHALL mirror the `e2e/next-app` pattern: a small set of components importing from `@animus-ui/test-ds`, its own system definition, and post-build structural assertions.

#### Scenario: Workspace registration
- **WHEN** the root `package.json` workspaces list is inspected
- **THEN** it SHALL include `"e2e/vite-app"`

#### Scenario: Package identity
- **WHEN** `e2e/vite-app/package.json` is inspected
- **THEN** it SHALL have `"name": "@animus-ui/vite-app"`, `"private": true`, and `"type": "module"`
- **AND** the name SHALL conform to the `e2e-workspace-convention` naming requirement (no `e2e`/`test`/`fixture` prefix or suffix)

### Requirement: Vite configuration with extraction plugin
The fixture SHALL use `animusExtract()` from `@animus-ui/vite-plugin` pointing to its own system file.

#### Scenario: Plugin configuration
- **WHEN** `e2e/vite-app/vite.config.ts` is inspected
- **THEN** it SHALL import `animusExtract` from `@animus-ui/vite-plugin` and `react` from `@vitejs/plugin-react`
- **AND** it SHALL call `animusExtract({ system: './src/ds.ts' })`

### Requirement: System definition from test-ds
The fixture SHALL define its own `src/ds.ts` that imports theme and system from `@animus-ui/test-ds` or builds a minimal system directly, producing a `SystemInstance` default export.

#### Scenario: System file exists and exports correctly
- **WHEN** `e2e/vite-app/src/ds.ts` is inspected
- **THEN** it SHALL export a `SystemInstance` as the default export
- **AND** it SHALL use `@animus-ui/system` builder APIs (`createSystem`, `createTheme`)

### Requirement: Component fixtures exercise builder chain surface
The fixture SHALL include components that collectively exercise: base styles (`.styles()`), variants (`.variant()`), compound variants (`.compound()`), states (`.states()`), system props (`.props()`), extension chains (`.extend()`), and composition (`compose()`).

#### Scenario: Component inventory
- **WHEN** `e2e/vite-app/src/components/` is inspected
- **THEN** it SHALL contain components covering at minimum: a base-styled element, a component with variants, a component with states, an extension chain (parent + child), and a composed family

#### Scenario: Components import from test-ds
- **WHEN** the fixture components are inspected
- **THEN** at least one component SHALL import from `@animus-ui/test-ds` to exercise cross-package extraction

### Requirement: Build and assertion scripts
The fixture SHALL include build scripts and structural post-build assertions runnable from the repo root.

#### Scenario: Build script
- **WHEN** `bun run --filter '@animus-ui/vite-app' build` is executed
- **THEN** Vite SHALL build the app to `e2e/vite-app/dist/`

#### Scenario: Root-level verification commands
- **WHEN** `bun run verify:build:vite` is executed from the repo root
- **THEN** it SHALL build the Vite fixture app via `scripts/verify/build-vite.sh`
- **AND** when `bun run verify:assert:vite` is executed
- **THEN** it SHALL run post-build assertions via `scripts/verify/assert-vite.sh`
- **AND** when `bun run verify:vite` is executed
- **THEN** it SHALL run both in sequence and exit with zero status when all assertions pass

#### Scenario: Integration with verify:full
- **WHEN** `bun run verify:full` is executed
- **THEN** it SHALL include `verify:build:vite && verify:assert:vite` in its pipeline

### Requirement: Fixture stays minimal
The fixture SHALL NOT include: MDX, animation libraries, icon libraries, routing, or any dependency not required for extraction testing. Dependencies SHALL be limited to `react`, `react-dom`, `@animus-ui/system`, `@animus-ui/test-ds`, `@animus-ui/vite-plugin`, `@vitejs/plugin-react`, and `vite`.

#### Scenario: Dependency audit
- **WHEN** `e2e/vite-app/package.json` dependencies are inspected
- **THEN** no dependency outside the allowed list SHALL be present

### Requirement: Keyframes collection fixture exists in Vite test app

The Vite test app's system module (`e2e/vite-app/src/ds.ts`) SHALL export a named `animations` binding that is the return value of `ds.createKeyframes({...})` — the builder-bound keyframes factory destructured from `createSystem({...}).build()`. The collection SHALL declare at least two distinct named keyframes with different frame bodies. At least one frame body entry SHALL reference a theme token so the `ThemedCSSProps<Theme>` typing contract is exercised under the rollup (Vite) build path in parallel to the Next adapter coverage.

#### Scenario: `animations` export is produced by the bound factory

- **WHEN** `e2e/vite-app/src/ds.ts` is inspected
- **THEN** it SHALL destructure `createKeyframes` from `createSystem({...}).build()` alongside `system`
- **AND** it SHALL export `animations = ds.createKeyframes({ <name1>: { ... }, <name2>: { ... } })` where `<name1>` and `<name2>` have different frame bodies
- **AND** the file SHALL NOT contain `import { keyframes } from '@animus-ui/system'`

#### Scenario: At least one frame body references a theme token

- **WHEN** the `animations` collection is inspected
- **THEN** at least one stop within at least one keyframe SHALL contain a value of the form `{scale.key}` referencing a scale defined on the fixture's theme
- **AND** the `@keyframes` block emitted by the Vite build SHALL resolve that reference to the CSS variable produced by the theme emitter

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

