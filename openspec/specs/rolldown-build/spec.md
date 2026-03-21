## ADDED Requirements

### Requirement: Rolldown as library bundler
Each published package (core, theming, ui) SHALL use Rolldown to produce ES module bundles. Rolldown SHALL handle TypeScript and JSX compilation natively without Babel or separate TypeScript emit plugins.

#### Scenario: Core package build
- **WHEN** `bun run build` executes in `packages/core`
- **THEN** Rolldown produces `dist/index.js` (ES module format) with all `node_modules` externalized

#### Scenario: TypeScript declaration output
- **WHEN** a package is built
- **THEN** `dist/index.d.ts` declaration files are generated (via tsc or Rolldown dts plugin)

### Requirement: No Babel in build pipeline
The build pipeline SHALL NOT use Babel for any purpose. No `babel.config.js`, `.babelrc`, or Babel-related dependencies SHALL exist in the repository.

#### Scenario: Babel removal verification
- **WHEN** searching the repository for Babel configuration files
- **THEN** no `babel.config.js`, `.babelrc`, or `babel.config.json` files exist at any level
- **THEN** no `@babel/*`, `babel-*`, or `babel-preset-*` entries exist in any `package.json`

### Requirement: Shared Rolldown base config
A shared Rolldown configuration SHALL be defined at the root. Per-package configs SHALL extend the shared base with minimal overrides (entry point, externals).

#### Scenario: Per-package config
- **WHEN** examining a package's `rolldown.config.ts`
- **THEN** it imports and extends the root shared config
- **THEN** package-specific config is no more than ~10 lines

### Requirement: Build output equivalence
The Rolldown build output SHALL be functionally equivalent to the current Rollup output: ES module format, single `dist/index.js` entry, all external dependencies excluded from the bundle.

#### Scenario: Output format
- **WHEN** inspecting `dist/index.js` after a Rolldown build
- **THEN** the file uses ES module syntax (import/export)
- **THEN** no `node_modules` code is inlined
