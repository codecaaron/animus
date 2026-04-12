## ADDED Requirements

### Requirement: Path alias resolution in import resolver
The extraction pipeline SHALL resolve tsconfig path aliases when building cross-file binding maps and extension provenance chains.

#### Scenario: Simple wildcard alias resolves to component
- **WHEN** tsconfig defines `"@admin/*": ["./src/*"]` and a component file imports `import { Button } from '@admin/components/Button'`
- **THEN** the import resolver SHALL expand the alias to `./src/components/Button` relative to project root
- **AND** resolve it against the known file set using existing extension-probing logic (`.ts`, `.tsx`, `.js`, `.jsx`, `/index.*`)

#### Scenario: Alias enables extension chain resolution
- **WHEN** file A defines `const NavBar = Button.extend().styles({...}).asElement('nav')` where Button is imported via `@admin/components/Button`
- **THEN** provenance resolution SHALL identify Button as NavBar's parent
- **AND** NavBar SHALL inherit Button's base styles, variants, and states through the merge path

#### Scenario: Non-matching alias falls through to package map
- **WHEN** an import specifier does not match any tsconfig path alias (e.g., `@tanstack/react-query`)
- **THEN** the resolver SHALL fall through to the existing package map lookup
- **AND** behavior for non-aliased imports SHALL be unchanged

#### Scenario: Multiple alias targets tried in order
- **WHEN** tsconfig defines `"@lib/*": ["./src/lib/*", "./src/shared/*"]`
- **THEN** the resolver SHALL try each target path in declaration order
- **AND** return the first match found in the known file set

### Requirement: Automatic tsconfig path extraction
The vite-plugin SHALL automatically read tsconfig path aliases without requiring explicit configuration.

#### Scenario: tsconfig.json at project root
- **WHEN** `tsconfig.json` exists at the project root with `compilerOptions.paths` defined
- **THEN** the plugin SHALL extract paths entries and serialize them for the Rust pipeline
- **AND** `compilerOptions.baseUrl` SHALL be used as the resolution root (defaulting to project root if absent)

#### Scenario: No tsconfig paths defined
- **WHEN** `tsconfig.json` exists but has no `compilerOptions.paths`
- **THEN** the plugin SHALL pass an empty alias map
- **AND** behavior SHALL be identical to current (no aliases resolved)

### Requirement: Research audit of real-world usage
Before implementation, an audit SHALL confirm that path aliases between Animus component files exist in real consumer projects.

#### Scenario: Blockworks audit
- **WHEN** blockworks os-admin source is audited for imports between Animus component files
- **THEN** the audit SHALL report how many component-to-component imports use `@admin/*` vs relative paths
- **AND** the result SHALL inform whether implementation proceeds or the limitation is documented only
