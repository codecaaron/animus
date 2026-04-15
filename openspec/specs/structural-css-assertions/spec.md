## Purpose

Shared, position-aware CSS assertion utilities SHALL live in `packages/_assertions/` (importable as `@animus-ui/assertions`) and replace shell `grep` / `find` for post-build validation. Character-position comparison lets assertions detect layer-order regressions that string containment cannot; centralizing the utilities also ensures Vite and Next consumer fixtures validate the same invariants against the same code.

## Requirements

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
The structural CSS assertion utilities SHALL be importable by both `e2e/vite-app` assertions and `e2e/next-app` assertions as a shared workspace module.

#### Scenario: Shared utility location
- **WHEN** the assertion utilities are authored
- **THEN** they SHALL live in `packages/_assertions/src/` (the post-topology home for shared assertions, established by `e2e-workspace-topology` and `shared-assertions-scaffold`)
- **AND** they SHALL be importable as `@animus-ui/assertions` from any `e2e/*` workspace package, from any `packages/*` script, and from `packages/_integration/`
- **AND** the import direction SHALL respect the one-way dependency rule (`e2e/* → packages/*`, never reverse)

### Requirement: Assertions replace shell grep
Post-build assertions for vite-app, showcase, and next-app SHALL use the structural assertion utilities instead of shell `grep`/`find` commands.

#### Scenario: Shell scripts replaced
- **WHEN** post-build assertion scripts are updated
- **THEN** `scripts/assert-showcase.sh` and `e2e/next-app/scripts/assert-next-build.sh` SHALL be replaced with TypeScript assertion scripts using the shared utilities
- **AND** `bun run verify:assert:showcase` and `bun run verify:assert:next` SHALL invoke the TypeScript scripts via `bun run` (delegated through the existing `scripts/verify/assert-*.sh` precondition wrappers)
