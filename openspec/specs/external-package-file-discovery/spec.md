## MODIFIED Requirements

### Requirement: Plugin resolves external packages to source directories

When `.includes()` declares external packages, the plugin SHALL resolve each package specifier via the bundler's resolver to obtain the dist entry path, walk up to the package root (directory containing `package.json`), then target `src/` if present. If `src/` does not exist, the plugin falls back to the dist entry directory.

#### Scenario: Workspace package with src/ directory

- **WHEN** `.includes([testDs])` references `@animus-ui/test-ds` and the resolved package root contains `src/`
- **THEN** the plugin SHALL walk `<pkg-root>/src/` for source files and redirect module resolution to `src/index.ts`

#### Scenario: Package without src/ directory (npm-installed)

- **WHEN** a discovered package resolves to a root without a `src/` directory
- **THEN** the plugin SHALL fall back to the dist entry, add it to file entries, and exempt the dist directory from extension and node_modules filters

#### Scenario: Unresolvable package name

- **WHEN** a specifier discovered from `.includes()` cannot be resolved via the bundler's resolver
- **THEN** the plugin SHALL silently skip that package — extraction continues with remaining packages and app files

### Requirement: External package files use identical file filters

Files discovered from external packages SHALL apply the same inclusion and exclusion filters as app source files: include `.ts` and `.tsx` extensions, exclude files matching `.test.`, `.spec.`, and any `node_modules` subdirectory within the package.

#### Scenario: Test files excluded from external package

- **WHEN** an external package's `src/` directory contains `Button.test.tsx`
- **THEN** that file SHALL NOT be included in the file entries passed to the Rust analyzer

#### Scenario: Source files included from external package

- **WHEN** an external package's `src/` directory contains `Button.tsx` and `Card.tsx`
- **THEN** both files SHALL be included in the file entries passed to `analyzeProject()`

### Requirement: External package files processed identically to app files

File entries from external packages SHALL be passed to `analyzeProject()` and `transform_file()` in the same array as app source file entries, with no special-casing or different treatment by the Rust layer.

#### Scenario: External and app files in same analyzeProject call

- **WHEN** the app has 50 source files and test-ds has 10 source files
- **THEN** `analyzeProject()` SHALL receive 60 file entries in a single call

#### Scenario: Token refs in library components resolve against consumer theme

- **WHEN** a library component uses `bg: 'primary'` and the consumer's theme defines `--color-primary`
- **THEN** the extracted CSS for that component SHALL contain `background: var(--color-primary)`

### Requirement: Consumer system config remains singular authority

The plugin SHALL NOT load, parse, or merge any `ds.ts` or system config found within external package directories. Only the consumer's configured `system` path is loaded via subprocess.

#### Scenario: Library ds.ts is ignored

- **WHEN** an external package contains `src/system.ts` exporting a SystemInstance
- **THEN** the plugin SHALL include that file in file entries for extraction only if it contains analyzable component code — it SHALL NOT load it as a system config
