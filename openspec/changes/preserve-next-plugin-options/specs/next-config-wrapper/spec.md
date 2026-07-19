## MODIFIED Requirements

### Requirement: withAnimus config wrapper

The `withAnimus()` function SHALL accept an options object with a required `system` path and return a function that wraps a Next.js config object, injecting the webpack plugin and loader.

#### Scenario: Minimal configuration

- **WHEN** consumer configures `withAnimus({ system: './src/ds.ts' })({ reactStrictMode: true })`
- **THEN** the returned config SHALL include the Animus webpack plugin and loader rule while preserving all original Next.js config options

#### Scenario: Missing system option

- **WHEN** consumer calls `withAnimus({})` without a `system` path
- **THEN** the function SHALL throw `[animus-extract] Missing required option \`system\`. Provide the path to your SystemInstance module: withAnimus({ system: "./src/ds.ts" })`

#### Scenario: Existing webpack config preserved

- **WHEN** the Next.js config already has a `webpack` function
- **THEN** `withAnimus()` SHALL compose with it — calling the user's webpack function first, then adding the Animus plugin, loader, and relevant aliases to the result

#### Scenario: Complete options forwarded to plugin

- **WHEN** a consumer configures `withAnimus` with any supported combination of `system`, `exclude`, `extensions`, `strict`, `verbose`, `prefix`, `engine`, and `layers`
- **THEN** the injected Animus webpack plugin SHALL retain the exact configured option values, including the complete extension list and layer order
