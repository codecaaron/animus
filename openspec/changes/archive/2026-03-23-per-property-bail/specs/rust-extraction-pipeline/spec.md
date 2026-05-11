## MODIFIED Requirements

### Requirement: Static style evaluation
The style evaluator SHALL convert ObjectExpression AST nodes to key-value style maps. It SHALL handle string literals, numeric literals, nested object literals (for pseudo-selectors and responsive values), and array literals. When encountering a property whose value is a function call, variable reference, template literal containing expressions, or member expression, the evaluator SHALL skip that individual property and continue evaluating remaining properties. It SHALL bail the entire object only on structural issues: spread elements, computed property keys, and getter/setter properties.

#### Scenario: Evaluate simple style object
- **WHEN** the evaluator processes `{ p: 0, display: 'inline-flex', borderRadius: 4 }`
- **THEN** it SHALL produce `{ "p": 0, "display": "inline-flex", "borderRadius": 4 }`

#### Scenario: Evaluate nested pseudo-selector
- **WHEN** the evaluator processes `{ '&:hover': { color: 'primary' } }`
- **THEN** it SHALL produce `{ "&:hover": { "color": "primary" } }`

#### Scenario: Evaluate responsive object
- **WHEN** the evaluator processes `{ fontSize: { _: 16, xs: 18 } }`
- **THEN** it SHALL produce `{ "fontSize": { "_": 16, "xs": 18 } }` (responsive resolution happens in CSS generation)

#### Scenario: Skip property with template literal expression
- **WHEN** the evaluator encounters `{ animation: \`${flow} 5s\`, color: 'red' }`
- **THEN** it SHALL skip `animation`, produce `{ "color": "red" }`, and report a skip warning for `animation`

#### Scenario: Skip property with variable reference
- **WHEN** the evaluator encounters `{ color: someVariable, display: 'flex' }`
- **THEN** it SHALL skip `color`, produce `{ "display": "flex" }`, and report a skip warning for `color`

#### Scenario: Bail on spread (structural)
- **WHEN** the evaluator encounters `{ ...baseStyles, color: 'red' }`
- **THEN** the entire object SHALL bail — spread affects object shape

#### Scenario: Bail on computed key (structural)
- **WHEN** the evaluator encounters `{ [dynamicKey]: 'red' }`
- **THEN** the entire object SHALL bail — computed keys affect object shape
