## ADDED Requirements

### Requirement: Post-build assertion script
The test app SHALL include a shell script that validates the Next.js build output for extraction correctness. The script SHALL exit with non-zero status on any assertion failure.

#### Scenario: CSS contains @layer declarations
- **WHEN** the build output CSS files are searched
- **THEN** they SHALL contain `@layer base` and `@layer variants`

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
The root `package.json` SHALL include a script that builds the Next.js test app and runs the assertion script.

#### Scenario: Verification command exists
- **WHEN** `bun run test:next` is executed from the repo root
- **THEN** it SHALL build the Next.js app and run the post-build assertions
- **AND** it SHALL exit with zero status when all assertions pass
