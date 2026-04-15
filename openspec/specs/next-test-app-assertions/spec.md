## Purpose

Post-build assertions SHALL validate that the Next.js consumer fixture (`e2e/next-app/`) correctly exercises the extraction pipeline end-to-end. Assertions run against built output (not source) and use shared structural utilities from `@animus-ui/assertions` so layer ordering, class-name prefixes, and placeholder hygiene are verified by the same code that validates the Vite and showcase consumers.

## Requirements

### Requirement: Post-build assertion script
The test app SHALL include a TypeScript assertion script (replacing the shell script) that validates the Next.js build output for extraction correctness using shared structural assertion utilities. The script SHALL exit with non-zero status on any assertion failure.

#### Scenario: CSS layer ordering is structurally correct
- **WHEN** the build output CSS files are inspected
- **THEN** `@layer` declarations SHALL be validated for correct positional ordering via character position comparison
- **AND** the assertion SHALL verify `@layer anm-base` precedes `@layer anm-variants`

#### Scenario: Class names follow animus pattern
- **WHEN** the build output JS or HTML files are searched
- **THEN** they SHALL contain class names matching the `animus-` prefix pattern

#### Scenario: No Emotion runtime
- **WHEN** the build output JS bundles are searched for `@emotion`
- **THEN** the search SHALL return no matches

#### Scenario: No unresolved transform placeholders
- **WHEN** the build output CSS files are searched for `__TRANSFORM__`
- **THEN** the search SHALL return no matches

#### Scenario: Both routers rendered
- **WHEN** the build output directory is inspected
- **THEN** it SHALL contain output for both App Router pages and Pages Router pages

### Requirement: Root-level verification command
The root `package.json` SHALL include atomic tier scripts (`verify:build:next` + `verify:assert:next`) and the `verify:next` composite that builds the Next.js test app and runs the TypeScript assertion script.

#### Scenario: Verification command exists
- **WHEN** `bun run verify:next` is executed from the repo root
- **THEN** it SHALL build the Next.js app via `verify:build:next` and run the post-build TypeScript assertions via `verify:assert:next` (not shell script)
- **AND** it SHALL exit with zero status when all assertions pass

### Requirement: Assertion script uses shared utilities
The Next.js post-build assertions SHALL import structural assertion utilities from the shared `@animus-ui/assertions` workspace package.

#### Scenario: Shared utility import
- **WHEN** the assertion script is inspected
- **THEN** it SHALL import `assertLayerOrder`, `assertNoPlaceholders`, and `assertClassNameFormat` from `@animus-ui/assertions`
