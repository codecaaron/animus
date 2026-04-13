## ADDED Requirements

### Requirement: Position-aware layer order validation
A shared assertion utility SHALL validate that CSS output contains all expected `@layer` blocks in the correct structural order using character position comparison, not string containment.

#### Scenario: Layer order assertion passes for correct CSS
- **WHEN** CSS contains `@layer` declaration, `:root` variables, `@layer anm-global`, `@layer anm-base`, `@layer anm-variants` in that positional order
- **THEN** the layer order assertion SHALL pass

#### Scenario: Layer order assertion fails for misordered CSS
- **WHEN** CSS contains `:root` variables AFTER `@layer anm-base` (as in the confirmed Lightning CSS cascade bug)
- **THEN** the layer order assertion SHALL fail with a message identifying which layers are misordered

#### Scenario: Layer order assertion fails for missing layers
- **WHEN** CSS is missing an expected `@layer` block
- **THEN** the assertion SHALL fail identifying the missing layer by name

### Requirement: Class name format validation
A shared assertion utility SHALL validate that CSS output contains class names matching the Animus naming convention.

#### Scenario: Class names use animus prefix
- **WHEN** the CSS output is inspected
- **THEN** it SHALL contain class names matching the `animus-` prefix pattern

### Requirement: Placeholder and token guards
Shared assertion utilities SHALL check for absence of extraction artifacts that indicate pipeline failures.

#### Scenario: No transform placeholders
- **WHEN** the CSS output is inspected
- **THEN** it SHALL NOT contain `__TRANSFORM__` strings

#### Scenario: No unresolved token references
- **WHEN** the CSS output is inspected against the theme's variable map
- **THEN** no raw token path strings (e.g., `{colors.primary}`) SHALL appear — all MUST be resolved to `var(--*)` references

#### Scenario: No Emotion runtime references
- **WHEN** the JS output is inspected
- **THEN** no file SHALL contain `@emotion` import references

### Requirement: Assertion utilities are importable
The structural CSS assertion utilities SHALL be importable by both `e2e/vite-app` assertions and `packages/next-test-app` assertions as a shared module.

#### Scenario: Shared utility location
- **WHEN** the assertion utilities are authored
- **THEN** they SHALL live in `e2e/helpers/assert-css.ts`
- **AND** they SHALL be importable via relative path from any `e2e/` workspace package and from `packages/next-test-app`

### Requirement: Assertions replace shell grep
Post-build assertions for vite-app, showcase, and next-test-app SHALL use the structural assertion utilities instead of shell `grep`/`find` commands.

#### Scenario: Shell scripts replaced
- **WHEN** post-build assertion scripts are updated
- **THEN** `scripts/assert-showcase.sh` and `packages/next-test-app/scripts/assert-next-build.sh` SHALL be replaced with TypeScript assertion scripts using the shared utilities
- **AND** `bun run test:showcase` and `bun run test:next` SHALL invoke the TypeScript scripts via `bun run`
