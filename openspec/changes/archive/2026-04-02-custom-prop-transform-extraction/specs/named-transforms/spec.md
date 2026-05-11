## MODIFIED Requirements

### Requirement: Rust extraction captures inline transform functions in custom prop configs
When the Rust `style_evaluator` encounters an inline function expression (`ArrowFunctionExpression` or `FunctionExpression`) as the value of a `transform` field in a `.props()` config object, it SHALL capture the function's source text from the AST span. This applies ONLY to the `transform` field — all other fields SHALL continue to bail on function expressions.

#### Scenario: Inline arrow function captured
- **WHEN** a `.props()` config contains `transform: (v) => \`${v}px\``
- **THEN** the style evaluator SHALL capture the source text `(v) => \`${v}px\`` and associate it with the `transform` property, without bailing

#### Scenario: Inline function expression captured
- **WHEN** a `.props()` config contains `transform: function(v) { return v + 'px'; }`
- **THEN** the style evaluator SHALL capture the source text of the function expression and associate it with the `transform` property

#### Scenario: Identifier reference still bails
- **WHEN** a `.props()` config contains `transform: myTransform` where `myTransform` is an identifier reference
- **THEN** the style evaluator SHALL bail on that property with "variable reference (non-static)" — identifier resolution is not supported for custom prop transforms

#### Scenario: Function expression on non-transform fields still bails
- **WHEN** a `.props()` config contains `scale: (v) => v * 2` (function on a non-transform field)
- **THEN** the style evaluator SHALL bail on that property as before — function capture applies only to `transform` fields

### Requirement: Inline transform function emitted directly in replacement JS
When a custom prop has a captured inline transform function, the transform_emitter SHALL emit the function body directly in the `customDynamicConfig` object, without using the shared `transforms` registry.

#### Scenario: Inline transform emitted in replacement
- **WHEN** a component has `.props({ sizing: { property: 'flexBasis', transform: (v) => \`${v}px\` } })` and `sizing` has dynamic JSX usage
- **THEN** the replacement JS SHALL contain `"transform":(v) => \`${v}px\`` in the customDynamicConfig for the `sizing` prop

#### Scenario: No transformName emitted for inline transforms
- **WHEN** a custom prop transform is an inline function (not a named group transform)
- **THEN** the replacement JS SHALL NOT contain a `"transformName"` field for that prop — there is no name

#### Scenario: Named group transforms still use registry
- **WHEN** a group-level prop config has `transform: Some("size")` (from TS subprocess serialization)
- **THEN** the replacement JS SHALL continue to emit `"transform":transforms.size` and `"transformName":"size"` — group transform path is unchanged
