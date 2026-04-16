## ADDED Requirements

### Requirement: createTransform callbacks must be self-contained
The callback function passed as the second argument to `createTransform(name, fn)` SHALL have no external references. The callback MUST be a pure function of its arguments and locally declared variables. It SHALL NOT import, reference, or close over any identifiers that are not: (a) its own parameters, (b) variables declared within the callback body, or (c) well-known JavaScript globals.

The well-known globals allowlist SHALL include: `String`, `Number`, `Math`, `parseInt`, `parseFloat`, `isNaN`, `RegExp`, `JSON`, `Array`, `Object`, `undefined`, `NaN`, `Infinity`, `console`, `Error`, `TypeError`.

#### Scenario: Self-contained callback passes validation
- **WHEN** a createTransform callback uses only its parameters, local variables, and well-known globals
- **THEN** extraction succeeds and the callback source is included in the manifest

#### Scenario: Callback referencing an imported helper fails validation
- **WHEN** a createTransform callback references `percentageOrAbsolute` imported from another module
- **THEN** extraction emits a diagnostic: `[bail] Transform 'size': callback references external symbol 'percentageOrAbsolute'. Transform callbacks must be self-contained (no imports or external references).`

#### Scenario: Callback referencing a closure variable fails validation
- **WHEN** a createTransform callback references a variable declared outside the callback but within the same file (e.g., a `const gridItemMap = {...}` above the callback)
- **THEN** extraction emits a diagnostic naming the external symbol

#### Scenario: Callback using Math global passes validation
- **WHEN** a createTransform callback uses `Math.round(value * 100)`
- **THEN** validation passes — `Math` is in the well-known globals allowlist

### Requirement: Rust extracts createTransform callback source spans
The Rust crate SHALL scan parsed AST for `CallExpression` nodes where the callee resolves to `createTransform`. For each match, it SHALL extract the first argument as the transform name (StringLiteral) and the second argument as the callback source. The extracted source SHALL be valid JavaScript — TypeScript type annotations MUST be stripped during extraction.

#### Scenario: Arrow function callback extracted
- **WHEN** source contains `createTransform('size', (value) => { ... })`
- **THEN** manifest includes `{ transforms: { "size": "(value) => { ... }" } }`

#### Scenario: TypeScript annotations stripped from extraction
- **WHEN** source contains `createTransform('typed', (value: string): string => { ... })`
- **THEN** extracted source is `(value) => { ... }` with type annotations removed

#### Scenario: Aliased import resolved
- **WHEN** source contains `import { createTransform as ct } from '@animus-ui/system'` and `ct('foo', fn)`
- **THEN** Rust resolves the alias and extracts the transform

#### Scenario: Non-string first argument emits diagnostic
- **WHEN** source contains `createTransform(dynamicName, fn)` where first arg is not a string literal
- **THEN** extraction emits diagnostic: `[bail] createTransform requires a static string name, got identifier`

### Requirement: Built-in transforms are self-contained
All built-in transforms exported from `@animus-ui/system` (`size`, `borderShorthand`, `gridItem`, `gridItemRatio`) SHALL have their helper function logic inlined directly into the callback body. No callback SHALL import or reference functions from `./utils` or any other module.

#### Scenario: size transform is self-contained
- **WHEN** the `size` transform callback is extracted
- **THEN** it contains the `percentageOrAbsolute` logic inline (no external reference)

#### Scenario: borderShorthand transform is self-contained
- **WHEN** the `borderShorthand` transform callback is extracted
- **THEN** it contains the `numberToTemplate` logic inline (no external reference)

### Requirement: Transform extraction runs during project analysis
Transform extraction SHALL occur during `project_analyzer`'s parse phase, running on ALL discovered files (not just files with builder chains). Extracted transforms SHALL be collected into the `UniverseManifest` output alongside component data.

#### Scenario: Transforms defined in separate file from builder chains
- **WHEN** transforms are defined in `src/transforms.ts` which has no builder chains
- **THEN** the transforms are still discovered and extracted during analysis

#### Scenario: Transforms defined inline in system file
- **WHEN** `createTransform('fluid', fn)` appears in `src/ds.ts` alongside `createSystem()`
- **THEN** the transform is extracted from the same file during analysis

#### Scenario: Duplicate transform names across files
- **WHEN** two files both define `createTransform('size', fn)` with different callbacks
- **THEN** extraction emits a diagnostic warning about the duplicate and uses the last-seen definition

### Requirement: Graceful degradation for non-extractable transforms
When a transform callback fails validation (external references), the system SHALL NOT halt extraction. The transform SHALL be omitted from the manifest's extracted transforms. Any `__TRANSFORM__` placeholders referencing that transform name SHALL pass through unresolved — the raw value is emitted as-is in the final CSS.

#### Scenario: Non-extractable transform with strict mode off
- **WHEN** a transform references an external symbol and `strict: false`
- **THEN** a warning is logged, the transform is omitted, and `__TRANSFORM__size__4__` becomes `4` in the final CSS

#### Scenario: Non-extractable transform with strict mode on
- **WHEN** a transform references an external symbol and `strict: true`
- **THEN** the build fails with a descriptive error including the transform name and external symbol
