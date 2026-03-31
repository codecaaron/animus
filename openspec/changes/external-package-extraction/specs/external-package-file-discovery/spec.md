## ADDED Requirements

### Requirement: Plugin resolves external packages to source directories
When the `packages` option is provided, the plugin SHALL resolve each named package to its source directory by calling `require.resolve('<pkg>/package.json')` to obtain the package root, then targeting the `src/` subdirectory if present, falling back to the directory of the package's `main` entry.

#### Scenario: Workspace package with src/ directory
- **WHEN** `packages: ['@animus-ui/test-ds']` is configured and `@animus-ui/test-ds` resolves to a directory containing `src/`
- **THEN** the plugin SHALL walk `<pkg-root>/src/` for source files to include in extraction

#### Scenario: Package without src/ directory
- **WHEN** a named package resolves to a root without a `src/` directory
- **THEN** the plugin SHALL fall back to walking the directory containing the package's `main` entry

#### Scenario: Unresolvable package name
- **WHEN** a name in `packages` cannot be resolved via `require.resolve`
- **THEN** the plugin SHALL log a warning and skip that package — extraction continues with remaining packages and app files

### Requirement: External package files use identical file filters
Files discovered from external packages SHALL apply the same inclusion and exclusion filters as app source files: include `.ts` and `.tsx` extensions, exclude files matching `.test.`, `.spec.`, and any `node_modules` subdirectory within the package.

#### Scenario: Test files excluded from external package
- **WHEN** an external package's `src/` directory contains `Button.test.tsx`
- **THEN** that file SHALL NOT be included in the file entries passed to the Rust analyzer

#### Scenario: Source files included from external package
- **WHEN** an external package's `src/` directory contains `Button.tsx` and `Card.tsx`
- **THEN** both files SHALL be included in the file entries passed to `analyzeProject()`

#### Scenario: Nested node_modules excluded
- **WHEN** an external package contains a `node_modules` directory within its source tree
- **THEN** files inside that directory SHALL NOT be included

### Requirement: External package files processed identically to app files
File entries from external packages SHALL be passed to `analyzeProject()` and `transform_file()` in the same array as app source file entries, with no special-casing or different treatment by the Rust layer.

#### Scenario: External and app files in same analyzeProject call
- **WHEN** the app has 50 source files and test-ds has 10 source files
- **THEN** `analyzeProject()` SHALL receive 60 file entries in a single call

#### Scenario: Token refs in library components resolve against consumer theme
- **WHEN** a library component uses `bg: 'primary'` and the consumer's theme defines `--color-primary`
- **THEN** the extracted CSS for that component SHALL contain `background: var(--color-primary)`

#### Scenario: Library component token missing from consumer theme
- **WHEN** a library component uses `color: 'accent-500'` and the consumer's theme does not define `--color-accent-500`
- **THEN** the extracted CSS for that component SHALL produce no output for the `color` property — same behavior as any unresolved token in app files

### Requirement: Consumer system config remains singular authority
The plugin SHALL NOT load, parse, or merge any `ds.ts` or system config found within external package directories. Only the consumer's configured `system` path is loaded via subprocess.

#### Scenario: Library ds.ts is ignored
- **WHEN** an external package contains `src/system.ts` exporting a SystemInstance
- **THEN** the plugin SHALL include that file in file entries for extraction only if it contains analyzable component code — it SHALL NOT load it as a system config

#### Scenario: Single system subprocess per build
- **WHEN** extraction runs with `packages: ['@animus-ui/test-ds', '@animus-ui/icons']`
- **THEN** only one system subprocess is spawned — for the consumer's configured `system` path
