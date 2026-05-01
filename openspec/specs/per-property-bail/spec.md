### Requirement: Per-property skip on non-static values

The style evaluator SHALL skip individual properties whose values cannot be statically evaluated, rather than bailing the entire style object. Skipped properties SHALL NOT appear in the extracted CSS. All other properties in the same object SHALL be extracted normally.

#### Scenario: Function call in one property, static values in others

- **WHEN** the evaluator processes `{ background: arr.join(''), color: 'red', p: 16 }`
- **THEN** `background` SHALL be skipped, and the result SHALL contain `{ "color": "red", "p": 16 }`

#### Scenario: Variable reference in one property

- **WHEN** the evaluator processes `{ bg: dynamicColor, fontSize: 14, display: 'flex' }`
- **THEN** `bg` SHALL be skipped, and the result SHALL contain `{ "fontSize": 14, "display": "flex" }`

#### Scenario: Template literal with expression in one property

- **WHEN** the evaluator processes ``{ animation: `${keyframeName} 2s`, opacity: 1 }``
- **THEN** `animation` SHALL be skipped, and the result SHALL contain `{ "opacity": 1 }`

#### Scenario: Member expression in one property

- **WHEN** the evaluator processes `{ color: theme.colors.primary, padding: '8px' }`
- **THEN** `color` SHALL be skipped, and the result SHALL contain `{ "padding": "8px" }`

#### Scenario: All properties non-static

- **WHEN** the evaluator processes `{ bg: dynamicA, color: dynamicB }`
- **THEN** the result SHALL be an empty object `{}` with skip warnings for both properties

#### Scenario: Component still gets class name with partial extraction

- **WHEN** a chain has `ds.styles({ background: arr.join(''), color: 'red', p: 16 }).asElement('div')`
- **THEN** the chain SHALL be marked `extractable: true`, receive a class name, and produce CSS containing `color` and `padding` declarations but NOT `background`

### Requirement: Structural errors still bail the entire object

Spread elements, computed property keys, and getter/setter properties SHALL still cause `eval_object_expr` to bail with an error for the entire object. These errors affect the shape of the object — the evaluator cannot determine the complete set of properties.

#### Scenario: Spread element bails entire object

- **WHEN** the evaluator processes `{ ...baseStyles, color: 'red' }`
- **THEN** the entire object SHALL bail (not just skip the spread) — `color: 'red'` is NOT extracted

#### Scenario: Computed property key bails entire object

- **WHEN** the evaluator processes `{ [dynamicKey]: 'value', color: 'red' }`
- **THEN** the entire object SHALL bail — the evaluator cannot know what `dynamicKey` resolves to

#### Scenario: Getter bails entire object

- **WHEN** the evaluator processes `{ get color() { return 'red' } }`
- **THEN** the entire object SHALL bail — getters are not static declarations

### Requirement: Recursive skip in nested objects

Per-property skip SHALL apply recursively within nested objects (pseudo-selector blocks, responsive value objects). A non-static value inside a nested block SHALL skip only that inner property.

#### Scenario: Non-static value inside pseudo-selector block

- **WHEN** the evaluator processes `{ '&:hover': { color: dynamicVar, bg: 'red' } }`
- **THEN** inside the `&:hover` block, `color` SHALL be skipped and `bg` SHALL be extracted

#### Scenario: Non-static pseudo-selector value (not an object)

- **WHEN** the evaluator processes `{ '&:hover': someFunction(), color: 'red' }`
- **THEN** `&:hover` SHALL be skipped as a property (its value is non-static), and `color` SHALL be extracted

#### Scenario: Spread inside nested object skips the parent property

- **WHEN** the evaluator processes `{ '&:hover': { ...hoverOverrides, bg: 'red' }, color: 'blue' }`
- **THEN** the `&:hover` nested object triggers structural bail, which causes the `&:hover` property to be skipped on the parent. `color: 'blue'` SHALL still be extracted.

### Requirement: Skip diagnostics in extraction output

Each skipped property SHALL produce a diagnostic warning in `ExtractionResult.errors` with a `[skip]` prefix. The warning SHALL include the component binding name, the property name, and the reason for skipping.

#### Scenario: Skip warning format

- **WHEN** property `background` is skipped in component `Hero` due to a function call
- **THEN** `ExtractionResult.errors` SHALL contain `"[skip] Hero: property 'background' — function call (non-static)"`

#### Scenario: Multiple skipped properties produce multiple warnings

- **WHEN** component `Card` has three non-static properties: `bg`, `boxShadow`, and `animation`
- **THEN** `ExtractionResult.errors` SHALL contain three `[skip]` entries, one for each property

#### Scenario: Skip warnings do not prevent extraction

- **WHEN** a component has skip warnings but also has static properties
- **THEN** `ExtractionResult.extractable` SHALL be `true` and `ExtractionResult.css` SHALL contain the static properties
