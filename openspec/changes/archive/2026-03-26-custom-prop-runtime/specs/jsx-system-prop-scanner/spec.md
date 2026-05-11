## MODIFIED Requirements

### Requirement: Output structure

The scanner SHALL produce deduplicated output containing:
- **Static system prop usages**: `(prop_name, value, component_binding)` tuples — global, shared across all components
- **Dynamic system prop usages**: `(prop_name, component_binding)` tuples — global, deduplicated by prop_name
- **Static custom prop usages**: `(prop_name, value, component_binding)` tuples — per-component, scoped to the defining component
- **Dynamic custom prop usages**: `(prop_name, component_binding)` tuples — per-component, scoped to the defining component
- Variant value activations per component
- State activations per component
- Set of rendered component bindings

Custom prop usages SHALL be tracked separately from system prop usages. A custom prop is identified by membership in the component's `custom_prop_configs` — it appears in the custom props scan output, not the system props scan output.

Dynamic deduplication for custom props SHALL be scoped per-component: if component A and component B both define a `size` custom prop, their dynamic usages are tracked independently.

#### Scenario: System prop static output
- **WHEN** `<Box p={8} />` is scanned and `p` is a system prop
- **THEN** a static system prop usage `("p", "8", "Box")` is emitted

#### Scenario: Custom prop static output
- **WHEN** `<Card size="sm" />` is scanned and `size` is a custom prop on Card
- **THEN** a static custom prop usage `("size", "sm", "Card")` is emitted

#### Scenario: Custom prop dynamic output
- **WHEN** `<Card size={someVar} />` is scanned and `size` is a custom prop on Card
- **THEN** a dynamic custom prop usage `("size", "Card")` is emitted

#### Scenario: Same prop name on different components
- **WHEN** `<Card size="sm" />` and `<Button size={3} />` both use `size` as a custom prop
- **THEN** separate custom prop usages are emitted for each component binding

#### Scenario: Mixed system and custom prop on same element
- **WHEN** `<Card p={8} size="sm" />` where `p` is a system prop and `size` is a custom prop
- **THEN** `p` appears in system prop output and `size` appears in custom prop output

## ADDED Requirements

### Requirement: Per-component custom prop dynamic detection

The scanner SHALL detect dynamic usage of custom props using the same detection rules as system props: identifier references, call expressions, conditional expressions, member expressions, template literals with expressions, and binary expressions.

Custom prop dynamic detection SHALL be scoped to the component that defines the custom prop. The scanner uses the `global_custom_props` map (binding → set of custom prop names) to determine which props are custom for each component.

#### Scenario: Custom prop identifier detected as dynamic
- **WHEN** `<Card size={mySize} />` is scanned and `size` is a custom prop on Card
- **THEN** a dynamic custom prop usage is recorded for Card's `size` prop

#### Scenario: Custom prop conditional detected as dynamic
- **WHEN** `<Card size={isLarge ? "lg" : "sm"} />` is scanned
- **THEN** a dynamic custom prop usage is recorded (conditional = dynamic, even with literal branches)

#### Scenario: Custom prop static value not marked dynamic
- **WHEN** `<Card size="sm" />` is scanned with a string literal value
- **THEN** only a static custom prop usage is recorded, no dynamic usage
