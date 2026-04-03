## MODIFIED Requirements

### Requirement: Unitless property set consistency
The set of CSS properties that SHALL NOT receive automatic `px` unit fallback MUST be identical between the build-time pipeline (`applyUnitFallback`) and the runtime dynamic path (`resolveClasses`). Both MUST reference a single shared definition.

#### Scenario: Shared unitless set
- **WHEN** the unitless property set is defined
- **THEN** it SHALL exist in exactly one location and be imported by both `extract/pipeline/unit-fallback.ts` and `system/src/runtime/resolveClasses.ts`

#### Scenario: Legacy flexbox properties
- **WHEN** a dynamic prop maps to `box-flex`, `box-flex-group`, `box-ordinal-group`, or `flex-order`
- **THEN** the runtime SHALL treat the value as unitless (no `px` appended), matching the pipeline behavior
