## MODIFIED Requirements

### Requirement: Showcase build output contains valid extraction CSS
After the showcase Vite build completes, the output CSS SHALL be validated using structural position-aware assertions, not shell `grep`. The assertion script SHALL use shared utilities from `e2e/helpers/assert-css.ts`.

#### Scenario: CSS file exists and is non-empty
- **WHEN** `bun run test:showcase` completes
- **THEN** at least one `.css` file SHALL exist in `packages/showcase/dist/assets/`
- **AND** the file SHALL be non-empty

#### Scenario: CSS layer ordering is structurally correct
- **WHEN** the showcase CSS output is inspected
- **THEN** `@layer` declaration SHALL precede `:root` variables
- **AND** `:root` variables SHALL precede `@layer anm-global`
- **AND** `@layer anm-global` SHALL precede `@layer anm-base`
- **AND** layer positions SHALL be validated via character position comparison (not string containment)

#### Scenario: No unresolved transform placeholders
- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL NOT contain `__TRANSFORM__` strings

#### Scenario: Variable CSS present
- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL contain `:root {` indicating CSS variable declarations were emitted

#### Scenario: Component class names present
- **WHEN** the showcase CSS output is inspected
- **THEN** it SHALL contain `animus-` prefixed class names

### Requirement: Showcase JS bundle has no runtime CSS dependencies
The showcase JS output SHALL NOT import Emotion or other runtime CSS-in-JS libraries.

#### Scenario: No Emotion imports in JS bundle
- **WHEN** the showcase JS output files are inspected
- **THEN** no file SHALL contain `@emotion` import references

### Requirement: Assertion script is TypeScript
The showcase post-build assertions SHALL be implemented as a TypeScript file using shared structural assertion utilities, replacing the shell script.

#### Scenario: Shell script replaced
- **WHEN** `bun run test:showcase` is executed
- **THEN** it SHALL run a TypeScript assertion script (not `bash scripts/assert-showcase.sh`)
- **AND** the script SHALL import assertion utilities from `e2e/helpers/assert-css.ts`
