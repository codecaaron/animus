## ADDED Requirements

### Requirement: withAnimus config wrapper
The package SHALL export a `withAnimus(nextConfig, options?)` function that returns a modified Next.js configuration with the webpack plugin and loader registered.

#### Scenario: Basic usage
- **WHEN** consumer configures `module.exports = withAnimus({ /* next config */ }, { system: './src/ds.ts' })`
- **THEN** the returned config SHALL include the Animus webpack plugin and loader in the webpack configuration

#### Scenario: Preserves existing webpack config
- **WHEN** the consumer's `nextConfig` already has a `webpack` function
- **THEN** `withAnimus` SHALL compose with it — calling the consumer's webpack function first, then adding the Animus plugin and loader to the result

#### Scenario: No options provided
- **WHEN** `withAnimus(nextConfig)` is called with no options
- **THEN** the plugin SHALL require the `system` option and throw a clear error: `"withAnimus requires a 'system' option pointing to your design system module"`

### Requirement: Options interface
The `withAnimus` options SHALL accept configuration for the system module path, verbose logging, and the runtime package name.

#### Scenario: System path option
- **WHEN** `{ system: './src/ds.ts' }` is provided
- **THEN** the plugin SHALL resolve it relative to the project root and use it as the system module path

#### Scenario: Verbose option
- **WHEN** `{ verbose: true }` is provided or `ANIMUS_DEBUG=1` environment variable is set
- **THEN** the plugin SHALL log analysis timing, file counts, and transform statistics to the console

#### Scenario: Runtime package option
- **WHEN** `{ runtimePackage: '@animus-ui/react' }` is provided
- **THEN** the Rust transform emitter SHALL use that package name for the `createComponent` import instead of the default

#### Scenario: Default runtime package
- **WHEN** no `runtimePackage` option is provided
- **THEN** the default SHALL be `'@animus-ui/react'`
