## ADDED Requirements

### Requirement: Boa engine context lifecycle
The `analyze_project` function SHALL create a single `boa_engine::Context` at the start of analysis. All extracted transform functions SHALL be registered into this context as named callable functions before CSS generation begins. The context SHALL be passed to the theme resolver via `ResolveContext` and live for the duration of the analysis call.

#### Scenario: Context created once per analysis
- **WHEN** `analyze_project` is called with files containing transform definitions
- **THEN** exactly one boa Context SHALL be created, and all transforms from all files SHALL be registered in it

#### Scenario: Context reused across files
- **WHEN** the theme resolver processes CSS values from multiple files in a single analysis run
- **THEN** all transform evaluations SHALL use the same boa Context instance

### Requirement: Transform function registration
Each extracted transform SHALL be registered in the boa context by evaluating its pure JavaScript source string and binding it to the transform's name. Registration SHALL occur after TS→JS stripping (via oxc_transformer + oxc_codegen) and validation.

#### Scenario: Built-in transform registered
- **WHEN** the `size` transform is extracted with source `(value) => { const toSize = ... ; ... }`
- **THEN** the boa context SHALL have a callable function bound to the name `"size"` that produces the same output as the original TypeScript function

#### Scenario: Invalid transform not registered
- **WHEN** a transform fails `validate_self_contained` (references external symbols)
- **THEN** it SHALL NOT be registered in the boa context and a diagnostic SHALL be emitted

#### Scenario: Custom user transform registered
- **WHEN** a user defines `createTransform('fluid', (v) => ...)` in their project files
- **THEN** the `"fluid"` function SHALL be registered in the boa context alongside built-in transforms

### Requirement: In-process transform evaluation
When the theme resolver encounters a CSS value that requires a named transform, it SHALL call the transform function in the boa context with the input value and return the result as a CSS string. No `__TRANSFORM__` placeholder SHALL be emitted.

#### Scenario: Numeric value evaluated
- **WHEN** `resolve_value` processes property `width` with value `0.5` and transform `"size"`
- **THEN** the boa context SHALL evaluate `size(0.5)` and return `"50%"` as the CSS value

#### Scenario: String value evaluated
- **WHEN** `resolve_value` processes property `width` with value `"100vh"` and transform `"size"`
- **THEN** the boa context SHALL evaluate `size("100vh")` and return `"100vh"` as the CSS value

#### Scenario: Numeric coercion for integer-like strings
- **WHEN** the input value is a JSON number (e.g., `4` from scale lookup)
- **THEN** the value SHALL be passed to the transform function as a JavaScript number, not a string

#### Scenario: Transform evaluation error falls back to raw value
- **WHEN** a transform function throws or returns undefined
- **THEN** the raw input value SHALL be used as the CSS value and a diagnostic warning SHALL be emitted

### Requirement: TS→JS stripping via oxc pipeline
Extracted transform source spans SHALL be converted from TypeScript to pure JavaScript using the oxc_transformer + oxc_codegen pipeline before registration in the boa context.

#### Scenario: Type annotations stripped
- **WHEN** a transform callback is `(value: number): string => String(value) + 'px'`
- **THEN** the registered source SHALL be pure JavaScript with type annotations removed

#### Scenario: `as` casts stripped
- **WHEN** a transform callback contains `value as string`
- **THEN** the registered source SHALL contain `value` without the cast

#### Scenario: `satisfies` expressions stripped
- **WHEN** a transform callback contains `result satisfies string`
- **THEN** the registered source SHALL contain `result` without the satisfies clause

#### Scenario: Plain JavaScript passes through unchanged
- **WHEN** a transform callback contains no TypeScript syntax
- **THEN** the registered source SHALL be semantically equivalent JavaScript
