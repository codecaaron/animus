## MODIFIED Requirements

### Requirement: @layer declaration order
The CSS output SHALL begin with `@layer global, base, variants, compounds, states, system, custom;` to establish layer precedence. The `compounds` layer is inserted between `variants` and `states`.

#### Scenario: Layer declaration includes compounds
- **WHEN** any extraction produces CSS
- **THEN** the layer declaration SHALL be `@layer global, base, variants, compounds, states, system, custom;`

#### Scenario: Empty compounds layer is harmless
- **WHEN** no component in the project uses `.compound()`
- **THEN** the `compounds` layer SHALL still appear in the declaration but have no rules — this is valid CSS and has no effect on cascade behavior
