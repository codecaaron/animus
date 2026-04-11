## MODIFIED Requirements

### Requirement: Rust extraction captures inline transform functions in custom prop configs
When the Rust `style_evaluator` encounters an inline function expression (`ArrowFunctionExpression` or `FunctionExpression`) as the value of a `transform` field in a `.props()` config object, it SHALL capture the function's source text via the oxc_transformer + oxc_codegen pipeline as pure JavaScript. This applies ONLY to the `transform` field — all other fields SHALL continue to bail on function expressions.

#### Scenario: Inline arrow function captured as JS
- **WHEN** a `.props()` config contains `transform: (v: number) => \`${v}px\``
- **THEN** the style evaluator SHALL capture and emit the source as pure JavaScript `(v) => \`${v}px\`` (TypeScript annotations removed), associating it with the `transform` property, without bailing

#### Scenario: Inline function expression captured as JS
- **WHEN** a `.props()` config contains `transform: function(v: string) { return v + 'px'; }`
- **THEN** the style evaluator SHALL capture and emit the source as `function(v) { return v + 'px'; }` (TypeScript annotations removed)

#### Scenario: Identifier reference still bails
- **WHEN** a `.props()` config contains `transform: myTransform` where `myTransform` is an identifier reference
- **THEN** the style evaluator SHALL bail on that property with "variable reference (non-static)" — identifier resolution is not supported for custom prop transforms

#### Scenario: Function expression on non-transform fields still bails
- **WHEN** a `.props()` config contains `scale: (v) => v * 2` (function on a non-transform field)
- **THEN** the style evaluator SHALL bail on that property as before — function capture applies only to `transform` fields

## REMOVED Requirements

### Requirement: Transform placeholder resolution
**Reason:** The `__TRANSFORM__` placeholder protocol is eliminated. Transform callbacks are evaluated in-process via boa_engine during CSS generation. CSS emerges from Rust fully resolved — no placeholders exist to resolve.
**Migration:** No consumer action needed. The `resolveTransformPlaceholders` function and `__TRANSFORM__` regex pattern are internal implementation details. CSS output is identical; only the resolution mechanism changes.
