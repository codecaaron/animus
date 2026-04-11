## ADDED Requirements

### Requirement: Loader registered for Turbopack
The per-file source transformation loader SHALL be registered in `turbopack.rules` so Turbopack can invoke it during compilation.

#### Scenario: Turbopack processes a component file
- **WHEN** Turbopack processes a `.tsx` file containing an Animus builder chain
- **THEN** the loader SHALL transform the source via `transformFile()` NAPI call, replacing builder chains with `createComponent()` calls

#### Scenario: Turbopack processes a non-component file
- **WHEN** Turbopack processes a `.tsx` file with no Animus components in the manifest
- **THEN** the loader SHALL return the source unchanged (no-op)

### Requirement: Loader registered for Webpack
The same loader SHALL also be registered in `module.rules` for Webpack backwards compatibility.

#### Scenario: Webpack processes a component file
- **WHEN** Webpack processes a `.tsx` file containing an Animus builder chain
- **THEN** the loader SHALL produce identical transformation output as it would under Turbopack

### Requirement: Loader does not handle CSS injection
The loader SHALL NOT inject, strip, or modify CSS import statements. CSS delivery is handled entirely via resolve aliases and user-land imports.

#### Scenario: Loader encounters CSS import
- **WHEN** the loader processes a file containing `import '@animus-ui/styles'`
- **THEN** the loader SHALL leave the import untouched
