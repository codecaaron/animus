## ADDED Requirements

### Requirement: Consumer-facing packages have quick-start READMEs
The packages `system`, `vite-plugin`, and `next-plugin` SHALL each have a README.md containing: install command, minimal setup, and a working code example using current API.

#### Scenario: system README shows group composition pattern
- **WHEN** a consumer reads `packages/system/README.md`
- **THEN** it SHALL show importing pre-built groups from `@animus-ui/system/groups` and composing them via `createSystem().addGroup()` — not raw property definitions

#### Scenario: system README shows a complete component
- **WHEN** a consumer reads `packages/system/README.md`
- **THEN** it SHALL include a component example using `ds.styles()`, `.variant()`, `.states()`, `.system()`, and `.asElement()` with JSX usage showing typed props

#### Scenario: vite-plugin README shows config setup
- **WHEN** a consumer reads `packages/vite-plugin/README.md`
- **THEN** it SHALL show a complete `vite.config.ts` with `animusExtract({ system: './src/ds.ts' })` and note that React resolve aliases must not be added

#### Scenario: next-plugin README shows config setup
- **WHEN** a consumer reads `packages/next-plugin/README.md`
- **THEN** it SHALL show a `next.config.mjs` with `withAnimus(nextConfig, { system: './src/ds.ts' })` and note RSC compatibility

### Requirement: Internal packages have minimal READMEs
The packages `extract` and `properties` SHALL each have a README.md explaining what the package does and that consumers do not install it directly.

#### Scenario: extract README identifies as internal
- **WHEN** a consumer reads `packages/extract/README.md`
- **THEN** it SHALL state that this package is consumed by `vite-plugin` and `next-plugin` and list supported platforms (darwin-arm64, linux-x64-gnu, linux-arm64-gnu)

#### Scenario: properties README identifies as transitive
- **WHEN** a consumer reads `packages/properties/README.md`
- **THEN** it SHALL state that this is a transitive dependency of `@animus-ui/system` and describe what data it provides (unitless set, shorthand mappings)

### Requirement: Root README reflects current architecture
The root `README.md` SHALL describe the zero-runtime static extraction architecture, use `ds.styles()` API (not `animus.styles()`), use `.system()` method (not `.groups()`), and not reference Emotion as a current feature.

#### Scenario: Root README shows extraction-based setup
- **WHEN** a consumer reads the root `README.md`
- **THEN** it SHALL show a two-file setup pattern (`theme.ts` + `ds.ts`) with pre-built group composition, bundler plugin config, and a component example

#### Scenario: Root README mentions legacy packages
- **WHEN** a consumer reads the root `README.md`
- **THEN** it SHALL mention `core` and `theming` as legacy Emotion-based packages that are pinned and no longer published

#### Scenario: Root README does not position Emotion as current
- **WHEN** a consumer reads the root `README.md`
- **THEN** it SHALL NOT contain phrases like "All Emotion features remain available" or reference `@emotion/*` as part of the current API

### Requirement: All READMEs use current method names
Every README SHALL use `.system()` for the component builder method that opts into prop groups. The old name `.groups()` SHALL NOT appear in any README.

#### Scenario: No stale method names
- **WHEN** any README is grep'd for `.groups(`
- **THEN** zero matches SHALL be found

### Requirement: Code examples use token ref syntax
README code examples that reference theme values SHALL use the token ref syntax `'{scale.key}'` with a brief inline explanation that it resolves to a CSS variable at build time.

#### Scenario: Token ref shown in context
- **WHEN** a component example uses a theme value (e.g., spacing, color)
- **THEN** it SHALL use `'{colors.primary}'` or `'{space.md}'` syntax, not raw CSS values or CSS variable syntax
