## MODIFIED Requirements

### Requirement: Concentric builder with sequential generic inference
The system builder SHALL provide a fluent API with callback-isolated phases: `.withTokens()` and `.withProperties()`. Each phase SHALL capture its generics independently via TypeScript's sequential method-chain inference. The terminal `.build()` SHALL return a `SystemInstance<T, PropRegistry, GroupRegistry, Selectors>`. The builder SHALL additionally accept `.withSelectors()` as a vocabulary registration phase alongside `.withTokens()` and `.withProperties()`.

#### Scenario: Full system definition
- **WHEN** consumer calls `createSystem().withTokens(t => t.breakpoints({...}).colors({...}).build()).withProperties(p => p.addGroup('surface', { color, border }).build()).withSelectors({ open: '[data-state="open"]' }).build()`
- **THEN** the return type SHALL be `SystemInstance<T, PropReg, GroupReg, Selectors>` where T is inferred from the token builder callback return, PropReg/GroupReg from the property builder callback return, and Selectors from the withSelectors argument

#### Scenario: Token phase captures T
- **WHEN** consumer calls `.withTokens(t => t.colors({ primary: '#4f46e5', secondary: '#7c3aed' }).build())`
- **THEN** T SHALL include `{ colors: { primary: string; secondary: string } }` and subsequent phases SHALL have access to `T`

#### Scenario: Property phase captures PropRegistry and GroupRegistry
- **WHEN** consumer calls `.withProperties(p => p.addGroup('surface', { color, border }).addGroup('text', { typography }).build())`
- **THEN** PropRegistry SHALL be the union of all prop definitions across groups, and GroupRegistry SHALL map group names to their prop keys

#### Scenario: Phases are lexically isolated
- **WHEN** inside the `.withTokens()` callback
- **THEN** only ThemeBuilder methods SHALL be available (not `.addGroup()` or `.build()` from the system level)

#### Scenario: withSelectors is optional
- **WHEN** consumer omits `.withSelectors()` from the builder chain
- **THEN** the system SHALL build with an empty selector registry (`Selectors = {}`) and all functionality SHALL work unchanged

#### Scenario: withSelectors ordering is flexible
- **WHEN** consumer calls `.withSelectors()` before `.withProperties()` or after `.withGlobalStyles()`
- **THEN** the builder SHALL accept the call in any position — `.withSelectors()` is order-independent like `.withGlobalStyles()`
