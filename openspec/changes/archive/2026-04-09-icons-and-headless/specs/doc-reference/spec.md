## MODIFIED Requirements

### Requirement: MethodCard provides expandable detail sections
MethodCard SHALL use ark-ui Accordion primitives for expand/collapse behavior while maintaining the existing consumer API. Accordion semantics (proper ARIA roles, multi-expand control) are delegated to ark-ui.

#### Scenario: MethodCard expand/collapse via ark-ui
- **WHEN** user clicks the MethodCard header
- **THEN** the detail section toggles visibility, managed by ark-ui's Accordion primitive with proper `aria-expanded` state

#### Scenario: MethodCard consumer API stable
- **WHEN** a consumer renders `<MethodCard name="method" params={[...]} returns="void">`
- **THEN** the component works identically to the pre-migration version
