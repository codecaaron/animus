### Requirement: createTransform utility function
The `@animus-ui/core` package SHALL export a `createTransform(name, fn)` function that accepts a string identifier and a transform function, and returns a new callable function decorated with a `.transformName` property. The returned function SHALL be a NEW function that delegates to the original (not a mutation of the original).

#### Scenario: Basic createTransform usage
- **WHEN** `const size = createTransform('size', (v) => typeof v === 'number' ? percentageOrAbsolute(v) : v)` is called
- **THEN** `size(4)` SHALL return `'4px'` AND `size.transformName` SHALL equal `'size'`

#### Scenario: Returned function is callable with original signature
- **WHEN** a `NamedTransform` is called as `transform(value, property, props)`
- **THEN** it SHALL delegate to the wrapped function with the same arguments and return its result

#### Scenario: Shared function reference safety
- **WHEN** the same underlying function is passed to two different `createTransform` calls (`createTransform('a', fn)` and `createTransform('b', fn)`)
- **THEN** the first result SHALL have `.transformName === 'a'` AND the second SHALL have `.transformName === 'b'` — neither overwrites the other

#### Scenario: NamedTransform satisfies TransformFn type
- **WHEN** a `NamedTransform` is assigned to a slot typed as `TransformFn` (the bare function type used in prop configs)
- **THEN** TypeScript SHALL accept the assignment without error — `NamedTransform` is a subtype of `TransformFn`

### Requirement: Built-in transforms use createTransform
All built-in transform functions exported from `@animus-ui/core` SHALL be wrapped with `createTransform`. The transform names SHALL match the identifiers currently used in serialization: `'size'`, `'borderShorthand'`, `'gridItemRatio'`, `'gridItem'`.

#### Scenario: size transform is named
- **WHEN** the `size` export from `@animus-ui/core` is inspected
- **THEN** `size.transformName` SHALL equal `'size'`

#### Scenario: borderShorthand transform is named
- **WHEN** the `borderShorthand` export from `@animus-ui/core` is inspected
- **THEN** `borderShorthand.transformName` SHALL equal `'borderShorthand'`

#### Scenario: gridItemRatio transform is named
- **WHEN** the `gridItemRatio` export from `@animus-ui/core` is inspected
- **THEN** `gridItemRatio.transformName` SHALL equal `'gridItemRatio'`

#### Scenario: gridItem transform is named
- **WHEN** the `gridItem` export from `@animus-ui/core` is inspected
- **THEN** `gridItem.transformName` SHALL equal `'gridItem'`

### Requirement: Serialization uses transformName with name fallback
The `getExtractConfig()` function SHALL serialize transform identifiers by reading `.transformName` from the transform function. If `.transformName` is not present, it SHALL fall back to `Function.name`. If neither produces a non-empty string, the transform SHALL be omitted from serialization.

#### Scenario: createTransform-wrapped function serializes correctly
- **WHEN** a prop config has `transform: createTransform('size', fn)` and `getExtractConfig()` serializes it
- **THEN** the serialized entry SHALL have `"transform": "size"`

#### Scenario: Bare named function falls back to Function.name
- **WHEN** a prop config has `transform: myCustomFn` where `myCustomFn` is a `const`-assigned function (`.name === 'myCustomFn'`, no `.transformName`)
- **THEN** the serialized entry SHALL have `"transform": "myCustomFn"`

#### Scenario: Anonymous function omits transform
- **WHEN** a prop config has `transform: (v) => v` (anonymous, no `.transformName`, `.name === ''`)
- **THEN** the serialized entry SHALL NOT include a `transform` field

#### Scenario: TRANSFORM_MAP is no longer used
- **WHEN** `getExtractConfig()` serializes transforms
- **THEN** it SHALL NOT reference any static `Map<Function, string>` — the mapping is derived from the function's own properties

### Requirement: Custom transforms follow the same protocol
Users defining custom transforms for their design system SHALL use `createTransform` to ensure extraction compatibility. Custom transforms created via `createTransform` SHALL be serialized and post-processed identically to built-in transforms.

#### Scenario: Custom transform in custom config
- **WHEN** a user defines `const fluid = createTransform('fluid', (v) => ...)` and uses it in `createAnimus().addGroup('text', { fontSize: { property: 'font-size', transform: fluid } })`
- **THEN** `getExtractConfig()` SHALL serialize the transform as `"transform": "fluid"` AND the Vite plugin SHALL apply the `fluid` function at build time

#### Scenario: Custom transform with same name as built-in
- **WHEN** a user defines `const size = createTransform('size', (v) => `${v}rem`)` overriding the built-in size behavior
- **THEN** the user's transform function SHALL be used (the config's function reference takes precedence), and serialization SHALL produce `"transform": "size"`
