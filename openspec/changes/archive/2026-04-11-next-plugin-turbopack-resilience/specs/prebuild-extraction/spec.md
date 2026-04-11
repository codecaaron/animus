## ADDED Requirements

### Requirement: Extraction runs before bundler boots
The extraction pipeline (`analyzeProject()`) SHALL execute during `withAnimus()` config resolution, before any Webpack or Turbopack compiler is instantiated.

#### Scenario: Next.js build with Turbopack
- **WHEN** `next build` runs with Turbopack as the default bundler
- **THEN** `.animus/styles.css` SHALL exist on disk with fully-resolved CSS before the first Turbopack compilation begins

#### Scenario: Next.js build with Webpack
- **WHEN** `next build` runs with `--webpack` flag
- **THEN** `.animus/styles.css` SHALL exist on disk before `compiler.hooks.run` fires

#### Scenario: Config resolution timing
- **WHEN** `withAnimus({ system: './src/ds.ts' })` is called in `next.config.ts`
- **THEN** the returned config function SHALL have the extraction manifest computed and CSS written to disk

### Requirement: Extraction output is physical files
The extraction pipeline SHALL write all outputs as physical files in the `.animus/` directory, not virtual modules or in-memory state.

#### Scenario: CSS output file
- **WHEN** extraction completes
- **THEN** `.animus/styles.css` SHALL contain the complete assembled stylesheet (layer declaration + variables + globals + component CSS)

#### Scenario: System props output file
- **WHEN** extraction completes and components use system props or dynamic props
- **THEN** `.animus/system-props.js` SHALL contain the `systemPropMap`, `dynamicPropConfig`, and `transforms` exports
