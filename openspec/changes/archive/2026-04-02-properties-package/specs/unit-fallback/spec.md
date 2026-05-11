## MODIFIED Requirements

### Requirement: Unitless properties are preserved
Properties in the unitless set SHALL NOT receive `px` suffix. The unitless set SHALL be imported from `@animus-ui/properties` — both the build-time pipeline (`applyUnitFallback`) and the runtime dynamic path (`resolveClasses`) SHALL reference the same `UNITLESS_PROPERTIES` export. No inline definitions.

#### Scenario: Line height preserved
- **WHEN** extracted CSS contains `line-height:1.5;`
- **THEN** post-processing SHALL NOT modify the value (line-height accepts unitless numbers)

#### Scenario: Opacity preserved
- **WHEN** extracted CSS contains `opacity:0.5;`
- **THEN** post-processing SHALL NOT modify the value

#### Scenario: Font weight preserved
- **WHEN** extracted CSS contains `font-weight:700;`
- **THEN** post-processing SHALL NOT modify the value

#### Scenario: Z-index preserved
- **WHEN** extracted CSS contains `z-index:10;`
- **THEN** post-processing SHALL NOT modify the value

#### Scenario: Flex preserved
- **WHEN** extracted CSS contains `flex:1;`
- **THEN** post-processing SHALL NOT modify the value

#### Scenario: Single source of truth
- **WHEN** both `extract/pipeline/unit-fallback.ts` and `system/src/runtime/resolveClasses.ts` need the unitless property set
- **THEN** both SHALL import `UNITLESS_PROPERTIES` from `@animus-ui/properties` — no inline Set definitions
