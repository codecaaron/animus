## ADDED Requirements

### Requirement: Configurable breakpoints negative type assertions
The type test suite SHALL include negative assertions verifying that invalid breakpoint keys in responsive prop objects produce type errors.

#### Scenario: Invalid breakpoint key rejected in responsive object
- **WHEN** a component with system props is given a responsive object with a key not in the augmented Theme's breakpoints
- **THEN** TypeScript SHALL produce a compile error
- **AND** a `@ts-expect-error` annotation SHALL guard this negative case

#### Scenario: Valid breakpoint keys accepted in responsive object
- **WHEN** a component with system props is given a responsive object with keys matching the augmented Theme's breakpoints (e.g., `xs`, `sm`, `md`, `lg`, `xl`) plus `_` for base
- **THEN** the expression SHALL compile without error

### Requirement: Type test coverage audit verified
All other recent features (compound variants, contextual vars, compose(), .system() mixed namespace, disjoint namespace constraint) SHALL have existing type assertions verified as comprehensive. No redundant assertions SHALL be added for features already covered in `types.test-d.tsx` sections §7, §7b, §10a-10f, §12, §13, §13b-§13e.

#### Scenario: Existing coverage preserved
- **WHEN** running `bun run test:types` after all changes
- **THEN** all existing type assertions in sections §7 through §13e SHALL continue to pass
- **AND** no existing `@ts-expect-error` annotations SHALL become unused (TS2578)
