## ADDED Requirements

### Requirement: Smoke test type verification
The smoke test package SHALL include a `tsconfig.json` and a `typecheck` script that runs `tsc --noEmit` to verify source-level type correctness of all component definitions and JSX usage.

#### Scenario: Type checking catches invalid variant
- **WHEN** smoke test source contains `<Button variant="typo">`
- **THEN** `tsc --noEmit` SHALL report a type error because `"typo"` is not in the variant union

#### Scenario: Type checking passes for valid usage
- **WHEN** smoke test source contains valid builder chains and JSX props
- **THEN** `tsc --noEmit` SHALL complete with zero errors

#### Scenario: asComponent path is exercised
- **WHEN** the smoke test includes a component defined via `.asComponent(WrappedComponent)`
- **THEN** the component SHALL extract correctly, forward `className` to the wrapped component, and render in the smoke test app
