## Purpose

Requirements for the `next-config-wrapper` capability: withAnimus config wrapper; Loader rule targets source files; .animus directory management.
## Requirements
### Requirement: withAnimus config wrapper

The `withAnimus()` function SHALL accept an options object with a required `system` path and return a function that wraps a Next.js config object, injecting the webpack plugin and loader.

#### Scenario: Minimal configuration

- **WHEN** consumer configures `withAnimus({ system: './src/ds.ts' })({ reactStrictMode: true })`
- **THEN** the returned config SHALL include the Animus webpack plugin and loader rule while preserving all original Next.js config options

#### Scenario: Missing system option

- **WHEN** consumer calls `withAnimus({})` without a `system` path
- **THEN** the function SHALL throw a descriptive error: `[animus] 'system' option is required`

#### Scenario: Existing webpack config preserved

- **WHEN** the Next.js config already has a `webpack` function
- **THEN** `withAnimus()` SHALL compose with it — calling the user's webpack function first, then adding the Animus plugin and loader to the result

#### Scenario: Options forwarded to plugin

- **WHEN** consumer configures `withAnimus({ system: './src/ds.ts', strict: true, verbose: true })`
- **THEN** the Animus webpack plugin SHALL receive `strict` and `verbose` options

### Requirement: Loader rule targets source files

The injected webpack loader rule SHALL target `.ts`, `.tsx`, `.js`, and `.jsx` files, excluding `node_modules`.

#### Scenario: Source files matched

- **WHEN** webpack resolves a `.tsx` file in the project source directory
- **THEN** the Animus loader SHALL process it

#### Scenario: Node modules excluded

- **WHEN** webpack resolves a `.tsx` file inside `node_modules/`
- **THEN** the Animus loader SHALL NOT process it

### Requirement: .animus directory management

The config wrapper SHALL ensure the `.animus/` output directory exists and document that it should be added to `.gitignore`.

#### Scenario: Output directory created

- **WHEN** `withAnimus()` initializes
- **THEN** it SHALL create `.animus/` in the project root if it does not exist

#### Scenario: Gitignore guidance

- **WHEN** `.animus/` is not present in `.gitignore`
- **THEN** the plugin SHALL log a one-time warning suggesting the user add `.animus/` to `.gitignore`

### Requirement: Engine selection option

The wrapper options SHALL include an optional engine field accepting v1 or v2, defaulting to v1, and the wrapper SHALL propagate the selection to every compiler instance's extraction calls, including non-owning instances.

#### Scenario: Unset engine preserves behavior

- WHEN wrapper options omit the engine field
- THEN builds behave identically to versions predating the field

#### Scenario: Selection reaches all compiler instances

- WHEN wrapper options set engine to v2 in a multi-compiler build
- THEN owning and non-owning compiler instances all route extraction through the v2 engine

